/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.all.d.ts" />
/// <reference path="typings/minimist/minimist.d.ts" />
/// <reference path="typings/mkpath/mkpath.d.ts" />

import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as minimist from 'minimist';
import * as mkpath from 'mkpath';
import {Enumerable} from 'ix';
import * as Rx from 'rx';

const htmlparser = require("htmlparser");

/**
 * Extended Minimist Interface 
 */
interface ITypeSheetOptions
{

    /**
     *  Output Directory
     *  default: '.'
     */
    output: string;

    /**
     * Do a pass with all matches immediately
     * default: false
     */
    init: boolean;

    /**
     * Regex to filter class names you want to be captured
     * default: ''
     */
    filterRegex: string;

    /**
     * Files to watch or node glob style path
     * default: ["**\/*.(cshtml|html)"]
     */
    _?: string[]

    /**
     * Print help information
     */
    help: boolean;
}

interface IHtmlParserDomModel
{
    raw: string;
    data: string;
    type: string;
    name: string;
    attribs?: { 'class'?: string, id?: string };
    children?: IHtmlParserDomModel[];
}

interface FlatDom
{
    raw: string;
    id: string;
    classes: string[];
}

const defaultOptions: ITypeSheetOptions = {
    init: false,
    output: '.',
    help: false,
    filterRegex: '.*'
};

const version = '0.9.2';

const reservedKeywordsRegex = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g;

const validSelectorRegex = /^[a-zA-Z]+[a-zA-Z0-9\-_]*$/;

const dotfileRegex = /[\/\\]\./;

function traverseChildren(children: IHtmlParserDomModel[])
{
    return Enumerable
        .fromArray(children.filter(x => x.type == "tag"))
        .selectMany(traverseChild);
}

function traverseChild({raw, attribs, children}: IHtmlParserDomModel): Enumerable<FlatDom>
{
    let flatChildren = traverseChildren(children || []);

    if (attribs)
    {
        let id = attribs.id && attribs.id.trim() || "";
        let classes = attribs.class && attribs.class.trim().split(' ').filter(x => x.trim().length > 0) || [];

        if (id.length > 0 || classes.length > 0)
        {
            return flatChildren.concat(Enumerable.return({ raw, id, classes }));
        }
    }

    return flatChildren;
}

function watch(filesOrGlobs: string[], initalPass: boolean): Rx.Observable<string>
{
    var subject = new Rx.Subject<string>();

    var watcher = chokidar.watch(filesOrGlobs, { ignored: dotfileRegex, });

    watcher.on('change', path => subject.onNext(path));

    if (initalPass)
    {
        watcher.on('add', path => subject.onNext(path));
    }

    watcher.on('error', error => subject.onError(error));

    return subject.asObservable();
}

function readFile(filePath: string)
{
    var fileSubject = new Rx.Subject<{ data: string, filePath: string }>();

    fs.readFile(filePath, 'utf-8', (error, data) =>
    {

        if (error)
        {
            fileSubject.onError(error);
        }
        else
        {
            fileSubject.onNext({ data, filePath });
        }

        fileSubject.onCompleted();

    });

    return fileSubject.asObservable();
}

function flattenDom(data: string): Enumerable<FlatDom>
{

    var handler = new htmlparser.DefaultHandler(function (error, dom) { });

    var parser = new htmlparser.Parser(handler);

    parser.parseComplete(data);

    return traverseChildren(handler.dom);
}

function template(name: string, raw: string[], sanitized: string, selector: string)
{

    return `
    /**
     *  ${name}  
     * ${raw.map(x => `\`\`\`${x}\`\`\``).join('\n')}  
     */
    export const ${sanitized} : string = "${selector}";
    `;
}

interface ViewModel
{
    context: string;
    sanitized: string;
    selector: string;
    name: string
}

function generateViewModels(dom: Enumerable<FlatDom>, filterRegex: RegExp): Enumerable<ViewModel>
{
    return dom.selectMany(({ id, raw: context, classes }: FlatDom) =>
    {

        var models = Enumerable.fromArray(classes)
            .select(selector => selector.trim())
            .where(selector => validSelectorRegex.test(selector) && filterRegex.test(selector))
            .select(selector => ({
                name: `.${selector}`,
                context,
                sanitized: sanitizedSelector(selector),
                selector: `.${selector}`
            }));

        if (id.length > 0 && validSelectorRegex.test(id.trim()))
        {
            return models.concat(Enumerable.return({
                name: `\\#${id}`,
                context,
                sanitized: `${sanitizedSelector(id)}Id`,
                selector: `#${id}`
            }));
        }

        return models;
    });
}

function generateTemplate(models: Enumerable<ViewModel>): Enumerable<string>
{
    return models.groupBy(x => x.sanitized)
        .select(x =>
        {
            var contexts = x.select(x => x.context);
            var first = x.first();
            var contextAndCounts = contexts
                .groupBy(x => x)
                .select(x => `${x.count()}x <${x.first()}>`);

            return template(first.name, contextAndCounts.toArray(), x.key, first.selector);
        });
}

/** Array.join implementation for enumerable */
function join(sequence: Enumerable<string>, separator: string = ``)
{
    return sequence.aggregate(``, (cumulus, x) => cumulus.concat(x));
}

function combineTemplate(name: string, selectors: Enumerable<string>): string
{
    return `namespace TypeSheet.${name} { ${join(selectors)} }`;
}

function replaceExtensionWithTs(filePath: string): string
{
    var baseName = path.basename(filePath, path.extname(filePath));

    return path.join(path.dirname(filePath), `${baseName}.ts`);
}

function writeFile(baseDir: string, filePath: string, typescript: string)
{
    var subject = new Rx.Subject<string>();

    var outputPath = path.join(baseDir, filePath);

    try
    {
        mkpath.sync(path.dirname(outputPath));
    }
    catch (error)
    {
        subject.onError(error);
    }

    fs.writeFile(outputPath, typescript, error =>
    {

        if (error)
        {
            subject.onError(error);
        }
        else
        {
            subject.onNext(outputPath);
        }

        subject.onCompleted();

    });

    return subject.asObservable();
}


/** Replaces occurrences of dashes, dots and underscores separated words to *camelCase* */
function toCamalCase(str: string)
{
    return str.replace(/[\-._]([a-zA-Z])/g, g => g[1].toUpperCase()).replace(/\-/g, '');
}

/**
 * Replace occurrences of any javascript keywords with the toUpperCase equivalent string
 */
function reservedToUpper(str: string)
{
    return str.replace(reservedKeywordsRegex, g => g.toUpperCase());
}

function sanitizedSelector(selector: string)
{
    return reservedToUpper(toCamalCase(selector));
}

function sanitizedNamespaceName(filePath: string)
{
    return reservedToUpper(toCamalCase(path.basename(filePath, path.extname(filePath))));
}

function beginWatch(options: ITypeSheetOptions)
{
    watch(options._, options.init)
        .groupBy(filePath => filePath)
        .flatMap(filePath => filePath
            .debounce(500)
            .flatMap(readFile)
            .map(({filePath, data}) => ({ data: flattenDom(data), filePath }))
            .map(({filePath, data}) => ({ data: generateViewModels(data, new RegExp(options.filterRegex)), filePath }))
            .distinctUntilChanged(x => x.data, (x, y) => Enumerable.sequenceEqual(x, y))
        )
        .map(({filePath, data}) => ({ data: generateTemplate(data), filePath }))
        .flatMap(({filePath, data}) =>
            writeFile(options.output, replaceExtensionWithTs(filePath), combineTemplate(sanitizedNamespaceName(filePath), data)))
        .subscribe(
            function next(path)
            {
                console.log(`TypeSheet Ready: ${path}`);
            },
            function error(error)
            {
                console.error(error);
            }
        );
}

function main(args: string[])
{
    var options = <ITypeSheetOptions><any>minimist(args, {
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

    if (options.help)
    {
        console.log(`
TypeSheet Version: ${version}

usage: typesheet [options] [files or globs]

    --init         -i   run initial pass on all matched files, default: false
    --output       -o   output directory, default: '.'
    --filterRegex  -f   class name filter matches are kept , default: '.*' i.e. all classes
    
    [files or globs] files or glob pattern to watch, default : **/*.(cshtml|html)
    
    glob reference:
    https://github.com/isaacs/node-glob`);

        return;
    }

    console.log(`Waiting for changes in: ${options._.join(' ')}`);

    beginWatch(options);
}

main(process.argv.slice(2));
