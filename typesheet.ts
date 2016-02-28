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
interface Options {
    
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

interface IHtmlParserDomModel {
    raw: string;
    data: string;
    type: string;
    name: string;
    attribs?: { 'class'?: string, id?: string };
    children?: IHtmlParserDomModel[];
}

interface FlatDom {
    raw: string;
    id: string;
    classes: string[];
}

const version = '0.8.0';

const reservedKeywordsRegex = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g;

const validSelectorRegex = /^[a-zA-Z]+[a-zA-Z0-9\-_]*$/;

const dotfileRegex = /[\/\\]\./;

function traverseChildren(children: IHtmlParserDomModel[]) {
    return Enumerable
        .fromArray(children.filter(x => x.type == "tag"))
        .selectMany(traverseChild);
}

function traverseChild({raw, attribs, children}: IHtmlParserDomModel): Enumerable<FlatDom> {

    let flatChildren = traverseChildren(children || []);

    if (attribs) {
        let id = attribs.id && attribs.id.trim() || "";
        let classes = attribs.class && attribs.class.trim().split(' ').filter(x => x.trim().length > 0) || [];

        if (id.length > 0 || classes.length > 0) {
            return flatChildren.concat(Enumerable.return({ raw, id, classes }));
        }
    }

    return flatChildren;
}

function watch(filesOrGlobs: string[], initalPass: boolean): Rx.Observable<string> {

    var subject = new Rx.Subject<string>();

    var watcher = chokidar.watch(filesOrGlobs, { ignored: dotfileRegex, });

    watcher.on('change', path => subject.onNext(path));

    if (initalPass) {
        watcher.on('add', path => subject.onNext(path));
    }

    watcher.on('error', error => subject.onError(error));

    return subject.asObservable();
}

function readFile(filePath: string) {
    
    var fileSubject = new Rx.Subject<{ data: string, filePath: string }>();

    fs.readFile(filePath, 'utf-8', (error, data) => {

        if (error) {
            fileSubject.onError(error);
        }
        else {
            fileSubject.onNext({ data, filePath });
        }

        fileSubject.onCompleted();

    });

    return fileSubject.asObservable();
}

function flattenDom(data: string): Enumerable<FlatDom> {

    var handler = new htmlparser.DefaultHandler(function(error, dom) { });

    var parser = new htmlparser.Parser(handler);

    parser.parseComplete(data);

    return traverseChildren(handler.dom);
}

var template = (name: string, raw: string[], sanitized: string, selector: string) => `
    /**
     *  ${name}  
     * ${raw.map(x => `\`\`\`
     * ${x}\`\`\``).join('\n')}  
     */
    export const ${sanitized} : string = "${selector}";
    `;

const toCamalCase = (str: string) => str.replace(/[\-.]([a-z])/g, g => g[1].toUpperCase()).replace(/\-/g, '');

function sanitize(selector: string, id: boolean) {
    var withoutReservedKeywords = selector.replace(reservedKeywordsRegex, g => g.toUpperCase());

    return `${toCamalCase(withoutReservedKeywords)}${id ? 'Id' : ''}`;
}

interface ViewModel {
    context: string;
    sanitized: string;
    selector: string;
    name: string
}

function isValidSelector(selector: string): boolean {
    return validSelectorRegex.test(selector);
}

function generateModelForEachClassAndId(dom: Enumerable<FlatDom>, filter: string): Enumerable<ViewModel> {

    var filterRegex = new RegExp(filter);
    
    return dom.selectMany(({ id, raw, classes }: FlatDom) => {

        var classTemplates = Enumerable.fromArray(classes)
            .select(x => x.trim())
            .where(className => isValidSelector(className) && filterRegex.test(className))
            .select(className => ({ name: `.${className}`, context: raw, sanitized: sanitize(className, false), selector: `.${className}` }));

        if (id.length > 0 && isValidSelector(id.trim())) {
            return classTemplates.concat(Enumerable.return({ context: raw, sanitized: sanitize(id, true), selector: `#${id}`, name: `\\#${id}` }));
        }

        return classTemplates;
    });
}

function generateTemplate(models: Enumerable<ViewModel>): Enumerable<string> {
    return models.groupBy(x => x.sanitized)
        .select(x => {
            var contexts = x.select(x => x.context);
            var first = x.first();
            var contextAndCounts = contexts
            .groupBy(x => x)
            .select(x => `${x.count()}x <${x.first()}>`);
            
            return template(first.name, contextAndCounts.toArray(), x.key, first.selector);
        });
}

function combineTemplate(name, selectors: Enumerable<string>): string {
    return `namespace TypeSheet.${name} { ${selectors.reduce((cumulus, x) => cumulus.concat(x), '')} }`;
}

function pathToTs(path: string): string {
    var tmp = path.split('.');
    tmp.pop();
    tmp.push('ts');
    return tmp.join('.');
}

function writeFile(baseDir: string, filePath: string, typescript: string) {
    
    var subject = new Rx.Subject<string>();
    
    var outputPath = path.join(baseDir,filePath);

    try {
        mkpath.sync(path.dirname(outputPath));
    } catch (error) {
      subject.onError(error);  
    }
    
    fs.writeFile(outputPath, typescript, error => {

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

function log(message: string) {
    console.log(message);
}

function sanitizedNamespaceName(name: string) {
    return path.basename(name, path.extname(name));
}

function main(args: string[]) {
    
    var defaults: Options = {
         init: false,
         output: '.',
         help: false,
         filterRegex: '.*'
    };

    var options = <Options> <any> minimist(args, { default: defaults,
        boolean: ['init','help'],
        string: 'output',
        alias: {
        init: 'i',
        output: 'o',
        help: 'h',
        filterRegex: 'f',
     }});
     
    options._ = options._.length > 0 ? options._ : ["**/*.(cshtml|html)"];
    
    if(options.help)
    {
        console.log(`
TypeSheet Version: ${version}

typesheet [options] [files or globs]

    --init         -i   run initial pass on all matched files, default: false
    --output       -o   output directory, default: '.'
    --filterRegex  -f   class name filter matches are kept , default: '.*' i.e. all classes
    
    [files or globs] files or glob pattern to watch, default : **/*.(cshtml|html)
    
    glob reference:
    https://github.com/isaacs/node-glob`);
        
        return;
    }
    
    console.log(`Waiting for changes in: ${options._.join(' ')}`);
    
    watch(options._, options.init)
        .groupBy(x => x)
        .flatMap(x => x
            .debounce(500)
            .flatMap(readFile)
            .map(({filePath, data}) => ({ data: flattenDom(data), filePath }))
            .map(({filePath, data}) => ({ data: generateModelForEachClassAndId(data, options.filterRegex), filePath }))
            .distinctUntilChanged(x => x.data, (x,y) => Enumerable.sequenceEqual(x, y))
        )
        .do(({filePath}) => {
            console.log(`Changed Detected: ${filePath}`);
        })
        .map(({filePath, data}) => ({ data: generateTemplate(data), filePath }))
        .flatMap(({filePath, data}) =>
         writeFile(options.output, pathToTs(filePath), combineTemplate(sanitizedNamespaceName(filePath), data)))
        .subscribe(
        function next(path) {
            console.log(`TypeSheet Ready: ${path}`);
        },
        function error(error) {
            console.error(error);
        }
        );
}

main(process.argv.slice(2));
