/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.d.ts" />
var chokidar = require('chokidar');
var fs = require('fs');
var ix_1 = require('ix');
var Rx = require('rx');
var htmlparser = require("htmlparser");
function flatMap(array, mapFunc) {
    return array.reduce(function (cumulus, next) { return mapFunc(next).concat(cumulus); }, []);
}
function traverseChildren(children) {
    return flatMap(children.filter(function (x) { return x.type == "tag"; }), traverseChild);
}
function traverseChild(_a) {
    var raw = _a.raw, attribs = _a.attribs, children = _a.children;
    var flatChildren = traverseChildren(children || []);
    if (attribs) {
        var id = attribs.id && attribs.id.trim() || "";
        var classes = attribs.class && attribs.class.trim().split(' ').filter(function (x) { return x.trim().length > 0; }) || [];
        if (id.length > 0 || classes.length > 0) {
            return [{ raw: raw, id: id, classes: classes }].concat(flatChildren);
        }
    }
    return flatChildren;
}
function watch(blob) {
    var subject = new Rx.Subject();
    // One-liner for current directory, ignores .dotfiles
    chokidar.watch(blob, { ignored: /[\/\\]\./, }).on('change', function (path) { return subject.onNext(path); });
    return subject.asObservable();
}
function readFile(path) {
    var fileSubject = new Rx.Subject();
    fs.readFile(path, 'utf-8', function (err, data) {
        if (err) {
            fileSubject.onError(err);
        }
        else {
            fileSubject.onNext({ path: path, data: data });
        }
        fileSubject.onCompleted();
    });
    return fileSubject.asObservable();
}
function parseHtml(data) {
    var handler = new htmlparser.DefaultHandler(function (error, dom) { });
    var parser = new htmlparser.Parser(handler);
    parser.parseComplete(data);
    return traverseChildren(handler.dom);
}
var template = function (name, raw, sanitized, selector) { return ("\n    /**\n     *  " + name + "  \n     *  ```<" + raw + ">```  \n     */\n    export const " + sanitized + " : string = \"" + selector + "\";\n    "); };
var sanitize = function (selector, id) { return ("" + (id ? '' : 'dot_') + selector.replace(/\-/g, '_')); };
var validSelectorRegex = /^[ ]*[a-zA-Z]+[a-zA-Z0-9\-_]*[ ]*$/;
function isValidSelector(selector) {
    return validSelectorRegex.test(selector);
}
function generateModelForEachClassAndId(dom) {
    return flatMap(dom, function (_a) {
        var id = _a.id, raw = _a.raw, classes = _a.classes;
        var classTemplates = classes
            .filter(function (className) { return isValidSelector(className); })
            .map(function (className) { return ({ name: "." + className, raw: raw, sanitized: sanitize(className, false), selector: "." + className }); });
        if (id.length > 0 && isValidSelector(id)) {
            return [{ raw: raw, sanitized: sanitize(id, true), selector: "#" + id, name: "\\#" + id }].concat(classTemplates);
        }
        return classTemplates;
    });
}
function generateTemplate(models) {
    return ix_1.Enumerable
        .fromArray(models)
        .groupBy(function (x) { return x.sanitized; })
        .map(function (x) { return x.first(); }) //TODO group raw for classes with multiple uses
        .map(function (x) { return template(x.name, x.raw, x.sanitized, x.selector); }).toArray();
}
function combineTemplate(selectors) {
    return "namespace TypeSheet { " + selectors.join('') + " }";
}
function pathToTs(path) {
    return path.replace('cshtml', 'ts');
}
function writeFile(path, typescript) {
    var subject = new Rx.Subject();
    fs.writeFile(pathToTs(path), typescript, function (error) {
        if (error) {
            subject.onError(error);
        }
        else {
            subject.onNext(path);
        }
        subject.onCompleted();
    });
    return subject.asObservable();
}
function log(message) {
    console.info(new Date().toISOString(), message);
}
function main() {
    watch("**/*.cshtml")
        .do(function (path) { return log("Changed Detected: " + path); })
        .do(function (path) { return console.time(pathToTs(path)); })
        .flatMap(readFile)
        .map(function (_a) {
        var path = _a.path, data = _a.data;
        return ({ path: path, dom: parseHtml(data) });
    })
        .map(function (_a) {
        var path = _a.path, dom = _a.dom;
        return ({ path: path, models: generateModelForEachClassAndId(dom) });
    })
        .map(function (_a) {
        var path = _a.path, models = _a.models;
        return ({ path: path, templates: generateTemplate(models) });
    })
        .map(function (_a) {
        var path = _a.path, templates = _a.templates;
        return ({ path: path, typescript: combineTemplate(templates) });
    })
        .flatMap(function (_a) {
        var path = _a.path, typescript = _a.typescript;
        return writeFile(path, typescript);
    })
        .subscribe(function next(path) {
        console.timeEnd(pathToTs(path));
    }, function error(error) {
        console.error(error);
    });
}
main();
//# sourceMappingURL=typesheet.js.map