/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.all.d.ts" />
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
            fileSubject.onNext(data);
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
var template = function (name, raw, sanitized, selector) { return ("\n    /**\n     *  " + name + "  \n     * " + raw.map(function (x) { return ("```\n     * <" + x + ">```"); }).join('\n') + "  \n     */\n    export const " + sanitized + " : string = \"" + selector + "\";\n    "); };
var toCamalCase = function (str) { return str.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); }).replace(/\-/g, ''); };
var reservedKeywordsRegex = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g;
function sanitize(selector, id) {
    var withoutReservedKeywords = selector.replace(reservedKeywordsRegex, function (g) { return g.toUpperCase(); });
    return "" + toCamalCase(withoutReservedKeywords) + (id ? 'Id' : '');
}
var validSelectorRegex = /^[ ]*[a-zA-Z]+[a-zA-Z0-9\-_]*[ ]*$/;
function isValidSelector(selector) {
    return validSelectorRegex.test(selector);
}
function generateModelForEachClassAndId(dom) {
    return flatMap(dom, function (_a) {
        var id = _a.id, raw = _a.raw, classes = _a.classes;
        var classTemplates = classes
            .filter(function (className) { return isValidSelector(className); })
            .map(function (className) { return ({ name: "." + className, context: raw, sanitized: sanitize(className, false), selector: "." + className }); });
        if (id.length > 0 && isValidSelector(id)) {
            return [{ context: raw, sanitized: sanitize(id, true), selector: "#" + id, name: "\\#" + id }].concat(classTemplates);
        }
        return classTemplates;
    });
}
function generateTemplate(models) {
    return ix_1.Enumerable
        .fromArray(models)
        .groupBy(function (x) { return x.sanitized; })
        .map(function (x) {
        var contexts = x.select(function (x) { return x.context; });
        var first = x.first();
        return template(first.name, contexts.toArray(), x.key, first.selector);
    })
        .toArray();
}
function combineTemplate(name, selectors) {
    return "namespace TypeSheet." + name + " { " + selectors.join('') + " }";
}
function pathToTs(path) {
    var tmp = path.split('.');
    tmp.pop();
    tmp.push('ts');
    return tmp.join('.');
}
function writeFile(path, typescript) {
    var subject = new Rx.Subject();
    fs.writeFile(path, typescript, function (error) {
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
function basename(path) {
    return path.split(/[\\/]/).pop();
}
function sanitizedNamespaceName(path) {
    return basename(path).split('.')[0];
}
function main(args) {
    var watchBlob = args[0] || "**/*.html";
    log("Waiting for changes: " + watchBlob);
    var html = watch(watchBlob).share();
    html
        .do(function (path) { return log("Changed Detected: " + path); })
        .do(function (path) { return console.time(pathToTs(path)); })
        .flatMap(readFile)
        .map(parseHtml)
        .map(generateModelForEachClassAndId)
        .map(generateTemplate)
        .zip(html, function (ts, path) {
        return writeFile(pathToTs(path), combineTemplate(sanitizedNamespaceName(path), ts));
    })
        .concatAll()
        .subscribe(function next(path) {
        console.timeEnd(path);
    }, function error(error) {
        console.error(error);
    });
}
main(process.argv.slice(2));
//# sourceMappingURL=typesheet.js.map