# typesheet
A utility to generate strongly typed dicitonary of the css selectors available in html files

```
> typesheet --help

usage: typesheet [options] [files or globs]

    --init         -i   run initial pass on all matched files, default: false
    --output       -o   output directory, default: '.'
    --filterRegex  -f   class name filter matches are kept , default: '.*' i.e. all classes

    [files or globs] files or glob pattern to watch, default : **/*.(cshtml|html)

    glob reference:
    https://github.com/isaacs/node-glob
    
    
```

## Example

### index.html
```html
    <div id="container">
      <!-- Example row of columns -->
      <div class="row">
        <div class="col-md-4">
          <h2>Heading</h2>
          <p><a class="btn btn-default" href="#" role="button">View details &raquo;</a></p>
        </div>
        <div class="col-md-4">
          <h2>Heading</h2>
          <p><a class="btn btn-default" href="#" role="button">View details &raquo;</a></p>
       </div>
        <div class="col-md-4">
          <h2>Heading</h2>
          <p><a class="btn btn-default" href="#" role="button">View details &raquo;</a></p>
        </div>
      </div>
```

### running typesheet

```
> node typesheet.js -i -o typings index.html
Waiting for changes in: index.html
TypeSheet Ready: typings/index.ts
```

### typings/index.ts

```ts
namespace TypeSheet.index {
    
    /**
     *  .btn  
     * 
     * 1x <a class="btn btn-primary btn-lg" href="#" role="button">
     * 3x <a class="btn btn-default" href="#" role="button">
     */
    export const btn : string = ".btn";
    
    /**
     *  .btn-primary  
     * 
     * 1x <a class="btn btn-primary btn-lg" href="#" role="button">
     */
    export const btnPrimary : string = ".btn-primary";
    
    /**
     *  .btn-lg  
     * 
     * 1x <a class="btn btn-primary btn-lg" href="#" role="button">
     */
    export const btnLg : string = ".btn-lg";
    
    /**
     *  .container  
     * 
     * 2x <div id="container">
     */
    export const containerId : string = "#container";
    
    /**
     *  .jumbotron  
     * 
     * 1x <div class="jumbotron">
     */
    export const jumbotron : string = ".jumbotron";
    
    /**
     *  .btn-default  
     *
     * 3x <a class="btn btn-default" href="#" role="button">
     */
    export const btnDefault : string = ".btn-default";
    
    /**
     *  .col-md-4  
     * 
     * 3x <div class="col-md-4">
     */
    export const colMd4 : string = ".col-md-4";
    
    /**
     *  .row  
     * 
     * 1x <div class="row">
     */
    export const row : string = ".row";
    
    /**
     *  .no-js  
     * 
     * 1x <html class="no-js" lang="">
     */
    export const noJs : string = ".no-js";
}
```

## VS Code Autocomplete
![image](https://cloud.githubusercontent.com/assets/1134912/13379216/2ebd2522-de6b-11e5-8afc-385831945a93.png)
![image](https://cloud.githubusercontent.com/assets/1134912/13379190/e460fdb4-de6a-11e5-8f5d-5a377097fe29.png)


## License
MIT