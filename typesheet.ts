/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.all.d.ts" />

import * as chokidar from 'chokidar';

import * as fs from 'fs';

import {Enumerable} from 'ix';

import * as Rx from 'rx';

var htmlparser = require("htmlparser");

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

function flatMap<T, U>(array: T[], mapFunc: (x: T) => U[]): U[] {
    return array.reduce((cumulus: U[], next: T) => [...mapFunc(next), ...cumulus], <U[]>[]);
}

function traverseChildren(children: IHtmlParserDomModel[]) {
    return flatMap<IHtmlParserDomModel, FlatDom>(children.filter(x => x.type == "tag"), traverseChild);
}

function traverseChild({raw, attribs, children}: IHtmlParserDomModel): FlatDom[] {
    let flatChildren = traverseChildren(children || []);

    if (attribs) {
        let id = attribs.id && attribs.id.trim() || "";
        let classes = attribs.class && attribs.class.trim().split(' ').filter(x => x.trim().length > 0) || [];

        if (id.length > 0 || classes.length > 0) {
            return <FlatDom[]>[{ raw, id, classes }, ...flatChildren];
        }
    }

    return flatChildren;
}

function watch(blob: string): Rx.Observable<string> {
    var subject = new Rx.Subject<string>();

    chokidar.watch(blob, { ignored: /[\/\\]\./, }).on('change', (path) => subject.onNext(path));

    return subject.asObservable();
}

function readFile(path: string): Rx.Observable<string> {
    var fileSubject = new Rx.Subject<string>();

    fs.readFile(path, 'utf-8', (err, data) => {

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

function parseHtml(data: string): FlatDom[] {
    var handler = new htmlparser.DefaultHandler(function(error, dom) { });

    var parser = new htmlparser.Parser(handler);

    parser.parseComplete(data);

    return traverseChildren(handler.dom);
}

var template = (name: string, raw: string[], sanitized: string, selector: string) => `
    /**
     *  ${name}  
     * ${raw.map(x => `\`\`\`
     * <${x}>\`\`\``).join('\n')}  
     */
    export const ${sanitized} : string = "${selector}";
    `;

const toCamalCase = (str: string) => str.replace(/-([a-z])/g, g => g[1].toUpperCase()).replace(/\-/g, '');

const reservedKeywordsRegex = /^(do|if|in|for|let|new|try|var|case|else|enum|eval|false|null|this|true|void|with|break|catch|class|const|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g;

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

const validSelectorRegex = /^[ ]*[a-zA-Z]+[a-zA-Z0-9\-_]*[ ]*$/;

function isValidSelector(selector: string): boolean {
    return validSelectorRegex.test(selector);
}

function generateModelForEachClassAndId(dom: FlatDom[]): ViewModel[] {
    return flatMap(dom, ({ id, raw, classes }: FlatDom) => {

        var classTemplates = classes
            .filter(className => isValidSelector(className))
            .map(className => ({ name: `.${className}`, context: raw, sanitized: sanitize(className, false), selector: `.${className}` }));

        if (id.length > 0 && isValidSelector(id)) {
            return [{ context: raw, sanitized: sanitize(id, true), selector: `#${id}`, name: `\\#${id}` }, ...classTemplates];
        }

        return classTemplates;
    });
}

function generateTemplate(models: ViewModel[]): string[] {
    return Enumerable
        .fromArray(models)
        .groupBy(x => x.sanitized)
        .map(x => {
            var contexts = x.select(x => x.context);
            var first = x.first();
            return template(first.name, contexts.toArray(), x.key, first.selector);
        })
        .toArray();
}

function combineTemplate(name, selectors: string[]): string {
    return `namespace TypeSheet.${name} { ${selectors.join('')} }`;
}

function pathToTs(path: string): string {
    var tmp = path.split('.');
    tmp.pop();
    tmp.push('ts');
    return tmp.join('.');
}

function writeFile(path: string, typescript: string) {
    var subject = new Rx.Subject<string>();

    fs.writeFile(path, typescript, error => {

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

function log(message: string) {
    console.info(new Date().toISOString(), message);
}

function basename(path: string) {
    return path.split(/[\\/]/).pop();
}

function sanitizedNamespaceName(path: string) {
    return basename(path).split('.')[0];
}

function main(args: string[]) {

    var watchBlob = args[0] || "**/*.html";

    log(`Waiting for changes: ${watchBlob}`);

    var html = watch(watchBlob).share();

    html
        .do(path => log(`Changed Detected: ${path}`))
        .do(path => console.time(pathToTs(path)))
        .flatMap(readFile)
        .map(parseHtml)
        .map(generateModelForEachClassAndId)
        .map(generateTemplate)
        .zip(html, (ts, path) =>
            writeFile(pathToTs(path), combineTemplate(sanitizedNamespaceName(path), ts)))
        .concatAll()
        .subscribe(
        function next(path) {
            console.timeEnd(path);
        },
        function error(error) {
            console.error(error);
        }
        );
}

main(process.argv.slice(2));
