/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.all.d.ts" />
/// <reference path="typings/minimist/minimist.d.ts" />
/// <reference path="typings/mkpath/mkpath.d.ts" />
var chokidar = require('chokidar');
var fs = require('fs');
var path = require('path');
var minimist = require('minimist');
var mkpath = require('mkpath');
var ix_1 = require('ix');
var Rx = require('rx');
var htmlparser = require("htmlparser");
var version = '0.8.0';
var reservedKeywordsRegex = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g;
var validSelectorRegex = /^[a-zA-Z]+[a-zA-Z0-9\-_]*$/;
var dotfileRegex = /[\/\\]\./;
function traverseChildren(children) {
    return ix_1.Enumerable
        .fromArray(children.filter(function (x) { return x.type == "tag"; }))
        .selectMany(traverseChild);
}
function traverseChild(_a) {
    var raw = _a.raw, attribs = _a.attribs, children = _a.children;
    var flatChildren = traverseChildren(children || []);
    if (attribs) {
        var id = attribs.id && attribs.id.trim() || "";
        var classes = attribs.class && attribs.class.trim().split(' ').filter(function (x) { return x.trim().length > 0; }) || [];
        if (id.length > 0 || classes.length > 0) {
            return flatChildren.concat(ix_1.Enumerable.return({ raw: raw, id: id, classes: classes }));
        }
    }
    return flatChildren;
}
function watch(filesOrGlobs, initalPass) {
    var subject = new Rx.Subject();
    var watcher = chokidar.watch(filesOrGlobs, { ignored: dotfileRegex, });
    watcher.on('change', function (path) { return subject.onNext(path); });
    if (initalPass) {
        watcher.on('add', function (path) { return subject.onNext(path); });
    }
    watcher.on('error', function (error) { return subject.onError(error); });
    return subject.asObservable();
}
function readFile(filePath) {
    var fileSubject = new Rx.Subject();
    fs.readFile(filePath, 'utf-8', function (error, data) {
        if (error) {
            fileSubject.onError(error);
        }
        else {
            fileSubject.onNext({ data: data, filePath: filePath });
        }
        fileSubject.onCompleted();
    });
    return fileSubject.asObservable();
}
function flattenDom(data) {
    var handler = new htmlparser.DefaultHandler(function (error, dom) { });
    var parser = new htmlparser.Parser(handler);
    parser.parseComplete(data);
    return traverseChildren(handler.dom);
}
var template = function (name, raw, sanitized, selector) { return ("\n    /**\n     *  " + name + "  \n     * " + raw.map(function (x) { return ("```\n     * " + x + "```"); }).join('\n') + "  \n     */\n    export const " + sanitized + " : string = \"" + selector + "\";\n    "); };
var toCamalCase = function (str) { return str.replace(/[\-.]([a-z])/g, function (g) { return g[1].toUpperCase(); }).replace(/\-/g, ''); };
function sanitize(selector, id) {
    var withoutReservedKeywords = selector.replace(reservedKeywordsRegex, function (g) { return g.toUpperCase(); });
    return "" + toCamalCase(withoutReservedKeywords) + (id ? 'Id' : '');
}
function isValidSelector(selector) {
    return validSelectorRegex.test(selector);
}
function generateModelForEachClassAndId(dom, filter) {
    var filterRegex = new RegExp(filter);
    return dom.selectMany(function (_a) {
        var id = _a.id, raw = _a.raw, classes = _a.classes;
        var classTemplates = ix_1.Enumerable.fromArray(classes)
            .select(function (x) { return x.trim(); })
            .where(function (className) { return isValidSelector(className) && filterRegex.test(className); })
            .select(function (className) { return ({ name: "." + className, context: raw, sanitized: sanitize(className, false), selector: "." + className }); });
        if (id.length > 0 && isValidSelector(id.trim())) {
            return classTemplates.concat(ix_1.Enumerable.return({ context: raw, sanitized: sanitize(id, true), selector: "#" + id, name: "\\#" + id }));
        }
        return classTemplates;
    });
}
function generateTemplate(models) {
    return models.groupBy(function (x) { return x.sanitized; })
        .select(function (x) {
        var contexts = x.select(function (x) { return x.context; });
        var first = x.first();
        var contextAndCounts = contexts
            .groupBy(function (x) { return x; })
            .select(function (x) { return (x.count() + "x <" + x.first() + ">"); });
        return template(first.name, contextAndCounts.toArray(), x.key, first.selector);
    });
}
function combineTemplate(name, selectors) {
    return "namespace TypeSheet." + name + " { " + selectors.reduce(function (cumulus, x) { return cumulus.concat(x); }, '') + " }";
}
function pathToTs(path) {
    var tmp = path.split('.');
    tmp.pop();
    tmp.push('ts');
    return tmp.join('.');
}
function writeFile(baseDir, filePath, typescript) {
    var subject = new Rx.Subject();
    var outputPath = path.join(baseDir, filePath);
    try {
        mkpath.sync(path.dirname(outputPath));
    }
    catch (error) {
        subject.onError(error);
    }
    fs.writeFile(outputPath, typescript, function (error) {
        if (error) {
            subject.onError(error);
        }
        else {
            subject.onNext(outputPath);
        }
        subject.onCompleted();
    });
    return subject.asObservable();
}
function log(message) {
    console.log(message);
}
function sanitizedNamespaceName(name) {
    return path.basename(name, path.extname(name));
}
function main(args) {
    var defaults = {
        init: false,
        output: '.',
        help: false,
        filterRegex: '.*'
    };
    var options = minimist(args, { default: defaults,
        boolean: ['init', 'help'],
        string: 'output',
        alias: {
            init: 'i',
            output: 'o',
            help: 'h',
            filterRegex: 'f',
        } });
    options._ = options._.length > 0 ? options._ : ["**/*.(cshtml|html)"];
    if (options.help) {
        console.log("\nTypeSheet Version: " + version + "\n\ntypesheet [options] [files or globs]\n\n    --init         -i   run initial pass on all matched files, default: false\n    --output       -o   output directory, default: '.'\n    --filterRegex  -f   class name filter matches are kept , default: '.*' i.e. all classes\n    \n    [files or globs] files or glob pattern to watch, default : **/*.(cshtml|html)\n    \n    glob reference:\n    https://github.com/isaacs/node-glob");
        return;
    }
    console.log("Waiting for changes in: " + options._.join(' '));
    console.log(options);
    watch(options._, options.init)
        .groupBy(function (x) { return x; })
        .flatMap(function (x) { return x
        .debounce(500)
        .flatMap(readFile)
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: flattenDom(data), filePath: filePath });
    })
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: generateModelForEachClassAndId(data, options.filterRegex), filePath: filePath });
    })
        .distinctUntilChanged(function (x) { return x.data; }, function (x, y) { return ix_1.Enumerable.sequenceEqual(x, y); }); })
        .do(function (_a) {
        var filePath = _a.filePath;
        console.log("Changed Detected: " + filePath);
    })
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: generateTemplate(data), filePath: filePath });
    })
        .flatMap(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return writeFile(options.output, pathToTs(filePath), combineTemplate(sanitizedNamespaceName(filePath), data));
    })
        .subscribe(function next(path) {
        console.log("TypeSheet Ready: " + path);
    }, function error(error) {
        console.error(error);
    });
}
main(process.argv.slice(2));
//# sourceMappingURL=typesheet.js.map