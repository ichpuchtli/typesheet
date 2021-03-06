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
var defaultOptions = {
    init: false,
    output: '.',
    help: false,
    filterRegex: '.*'
};
var version = '0.9.2';
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
function template(name, raw, sanitized, selector) {
    return "\n    /**\n     *  " + name + "  \n     * " + raw.map(function (x) { return ("```" + x + "```"); }).join('\n') + "  \n     */\n    export const " + sanitized + " : string = \"" + selector + "\";\n    ";
}
function generateViewModels(dom, filterRegex) {
    return dom.selectMany(function (_a) {
        var id = _a.id, context = _a.raw, classes = _a.classes;
        var models = ix_1.Enumerable.fromArray(classes)
            .select(function (selector) { return selector.trim(); })
            .where(function (selector) { return validSelectorRegex.test(selector) && filterRegex.test(selector); })
            .select(function (selector) { return ({
            name: "." + selector,
            context: context,
            sanitized: sanitizedSelector(selector),
            selector: "." + selector
        }); });
        if (id.length > 0 && validSelectorRegex.test(id.trim())) {
            return models.concat(ix_1.Enumerable.return({
                name: "\\#" + id,
                context: context,
                sanitized: sanitizedSelector(id) + "Id",
                selector: "#" + id
            }));
        }
        return models;
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
/** Array.join implementation for enumerable */
function join(sequence, separator) {
    if (separator === void 0) { separator = ""; }
    return sequence.aggregate("", function (cumulus, x) { return cumulus.concat(x); });
}
function combineTemplate(name, selectors) {
    return "namespace TypeSheet." + name + " { " + join(selectors) + " }";
}
function replaceExtensionWithTs(filePath) {
    var baseName = path.basename(filePath, path.extname(filePath));
    return path.join(path.dirname(filePath), baseName + ".ts");
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
/** Replaces occurrences of dashes, dots and underscores separated words to *camelCase* */
function toCamalCase(str) {
    return str.replace(/[\-._]([a-zA-Z])/g, function (g) { return g[1].toUpperCase(); }).replace(/\-/g, '');
}
/**
 * Replace occurrences of any javascript keywords with the toUpperCase equivalent string
 */
function reservedToUpper(str) {
    return str.replace(reservedKeywordsRegex, function (g) { return g.toUpperCase(); });
}
function sanitizedSelector(selector) {
    return reservedToUpper(toCamalCase(selector));
}
function sanitizedNamespaceName(filePath) {
    return reservedToUpper(toCamalCase(path.basename(filePath, path.extname(filePath))));
}
function beginWatch(options) {
    watch(options._, options.init)
        .groupBy(function (filePath) { return filePath; })
        .flatMap(function (filePath) { return filePath
        .debounce(500)
        .flatMap(readFile)
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: flattenDom(data), filePath: filePath });
    })
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: generateViewModels(data, new RegExp(options.filterRegex)), filePath: filePath });
    })
        .distinctUntilChanged(function (x) { return x.data; }, function (x, y) { return ix_1.Enumerable.sequenceEqual(x, y); }); })
        .map(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return ({ data: generateTemplate(data), filePath: filePath });
    })
        .flatMap(function (_a) {
        var filePath = _a.filePath, data = _a.data;
        return writeFile(options.output, replaceExtensionWithTs(filePath), combineTemplate(sanitizedNamespaceName(filePath), data));
    })
        .subscribe(function next(path) {
        console.log("TypeSheet Ready: " + path);
    }, function error(error) {
        console.error(error);
    });
}
function main(args) {
    var options = minimist(args, {
        default: defaultOptions,
        boolean: ['init', 'help'],
        string: 'output',
        alias: {
            init: 'i',
            output: 'o',
            help: 'h',
            filterRegex: 'f',
        }
    });
    options._ = options._.length > 0 ? options._ : ["**/*.(cshtml|html)"];
    if (options.help) {
        console.log("\nTypeSheet Version: " + version + "\n\nusage: typesheet [options] [files or globs]\n\n    --init         -i   run initial pass on all matched files, default: false\n    --output       -o   output directory, default: '.'\n    --filterRegex  -f   class name filter matches are kept , default: '.*' i.e. all classes\n    \n    [files or globs] files or glob pattern to watch, default : **/*.(cshtml|html)\n    \n    glob reference:\n    https://github.com/isaacs/node-glob");
        return;
    }
    console.log("Waiting for changes in: " + options._.join(' '));
    beginWatch(options);
}
main(process.argv.slice(2));
//# sourceMappingURL=typesheet.js.map