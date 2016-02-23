/// <reference path="typings/chokidar/chokidar.d.ts" />
/// <reference path="typings/ix.js/ix.d.ts" />
/// <reference path="typings/rx/rx.d.ts" />

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

    // One-liner for current directory, ignores .dotfiles
    chokidar.watch(blob, { ignored: /[\/\\]\./, }).on('change', (path) => subject.onNext(path));

    return subject.asObservable();
}



function readFile(path: string): Rx.Observable<{ path: string, data: string }> {
    var fileSubject = new Rx.Subject<{ path: string, data: string }>();

    fs.readFile(path, 'utf-8', (err, data) => {

        if (err) {
            fileSubject.onError(err);
        }
        else {
            fileSubject.onNext({ path, data });
        }

        fileSubject.onCompleted();

    });

    return fileSubject.asObservable();
}

function parseHtml(data: string): FlatDom[]
{
    var handler = new htmlparser.DefaultHandler(function(error, dom) { });

    var parser = new htmlparser.Parser(handler);

    parser.parseComplete(data);

    return traverseChildren(handler.dom);
}

var template = (name: string, raw: string, sanitized: string, selector: string) => `
    /**
     *  ${name}  
     *  \`\`\`html
     * <${raw}>\`\`\`  
     */
    export const ${sanitized} : string = "${selector}";
    `;

var sanitize = (selector: string, id: boolean) => `${id ? '' : 'dot_'}${selector.replace(/\-/g, '_')}`;

interface ViewModel {
    raw: string;
    sanitized: string;
    selector: string;
    name: string
}

const validSelectorRegex = /^[ ]*[a-zA-Z]+[a-zA-Z0-9\-_]*[ ]*$/;

function isValidSelector(selector: string) : boolean
{
    return validSelectorRegex.test(selector);
}

function generateModelForEachClassAndId(dom: FlatDom[]): ViewModel[]
{
    return flatMap(dom, ({ id, raw, classes }: FlatDom) => {

        var classTemplates = classes
            .filter(className => isValidSelector(className))
            .map(className => ({ name: `.${className}`, raw, sanitized: sanitize(className, false), selector: `.${className}` }));

        if (id.length > 0 && isValidSelector(id))
        {
            return [{ raw, sanitized: sanitize(id, true), selector: `#${id}`, name: `\\#${id}` }, ...classTemplates];
        }

        return classTemplates;
    });
}

function generateTemplate(models: ViewModel[]): string[] {
    return Enumerable
        .fromArray(models)
        .groupBy(x => x.sanitized)
        .map(x => x.first()) //TODO group raw for classes with multiple uses
        .map(x=> template(x.name, x.raw, x.sanitized, x.selector)).toArray();
}

function combineTemplate(selectors: string[]): string {
    return `namespace TypeSheet { ${selectors.join('')} }`;
}

function pathToTs(path: string) : string
{
    return path.replace('cshtml', 'ts');
}

function writeFile(path: string, typescript: string) {
    var subject = new Rx.Subject<string>();

    fs.writeFile(pathToTs(path), typescript, error => {

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

function log(message: string)
{
    console.info(new Date().toISOString(), message);
}


function main() {

    watch("**/*.cshtml")
        .do(path => log(`Changed Detected: ${path}`))
        .do(path => console.time(pathToTs(path)))
        .flatMap(readFile)
        .map(({path, data}) => ({ path, dom: parseHtml(data) }))
        .map(({path, dom}) => ({ path, models: generateModelForEachClassAndId(dom) }))
        .map(({path, models}) => ({ path, templates: generateTemplate(models) }))
        .map(({path, templates}) => ({ path, typescript: combineTemplate(templates) }))
        .flatMap(({path, typescript}) => writeFile(path, typescript))
        .subscribe(
            function next(path) {
               console.timeEnd(pathToTs(path))
            },
            function error(error) {
               console.error(error);
            }
        );

}

main();