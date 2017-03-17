/**
 * 实现将老的依赖注入方式批量转换成新的依赖注入方式
 * 老的方式有：
 * 1、   注入：services.inject();
 *      使用： services.x
 *
 * 2、   申明：let GLOBAL_CONSTANT
 *      注入：({GLOBAL_CONSTANT, cache} = services.inject('GLOBAL_CONSTANT', 'cache'));
 *      使用：GLOBAL_CONSTANT
 *
 * 解决方案：
 *      删除：services.inject();   //done
 *      删除：({GLOBAL_CONSTANT, cache} = services.inject('GLOBAL_CONSTANT', 'cache'));    //done ,且不删除注释
 *      获取：所有注入，（services.inject有默认注入，所以，实际上只要获取显式注入即可）//done
 *      新增：services.inject(this, 'GLOBAL_CONSTANT');   //done
 *      替换：GLOBAL_CONSTANT => this.GLOBAL_CONSTANT
 *      替换：services. => this.
 *      额外：this的有效性，需要用户自己检查
 *      额外：输出替换名单，方便检查
 */

var path = require("path");
var fs = require("fs");
var appTools = require("hj-app-tools");


var filterConfig = {

};

var contextPath = "";
var that;
var Counter = _counter();
var matchInfoPath = "";
var appendNum = 0;

/**
 * 入口函数
 * @param source
 */
module.exports = function (source) {
    this.cacheable && this.cacheable();
    that = this;
    contextPath = this.options.context;
    var result = source;

    //格式化配置
    if (this.query.enclude) {
        filterConfig.enclude = this.query.enclude
    }
    if (this.query.exclude) {
        filterConfig.exclude = this.query.exclude
    }
    if (this.query.config) {
        var config = this.query.config;
        matchInfoPath = config.matchInfoPath;
    }

    //按过滤进行处理
    var releavePath = path.relative(this.options.context, this.resourcePath);
    if (appTools.filterWithConifg(releavePath, filterConfig)) {
        //过滤到，则处理
        result  = _doTransform(source);
    }

    return result;
};

/**
 * 进行代码转换
 * @param source
 * @private
 */
function _doTransform(source) {

    var result = source;

    var injectArr = _collectStaticInject(result);
    result = _replaceInject(result, injectArr);
    result = _replaceVariable(result);

    writeResultBack(result);
    //return 匹配后的内容，可以检查打包脚本是否会跑失败，提前检查问题
    return result;
}

/**
 * 进行注入的替换
 * @param source
 * @private
 */
function _replaceVariable(source) {
    //正向思考
    //1、services.xx  =>  this.xx
    //2、services.xx.  =>  this.xx.
    //3、services[xx]  =>  this[xx]
    //4、services  =>  this
    //5、排除import以及inject中的services

    //反向思考
    //1、替换所有services => this
    //除了：a、{services}
    //除了：b、services.js
    //除了：c、services.inject(
    //除了：d、包含services的单词。 通过正则"/services\w/"已经验证没有这样的字段。

    var regServices = /services(?!(?:\.inject)|(?:\.js)|\s*?\})/g;
    var matchArr = [];
    source = source.replace(regServices, function (matchStr, index, fullStr) {
        matchArr.push(fullStr.substr(index, 100));
        return "this";
    })

    // console.log(that.resourcePath);
    // console.log(matchArr);
    writeVariableInfo(matchArr);
    return source;

}


/**
 * 搜集静态注入
 * @param source
 * @returns {Array}
 * @private
 */
function _collectStaticInject(source) {

    source = source + "";
    //搜集 静态注入
    var regGetInject = /services\.inject\(.*?\)/g;
    var injectArrTmp = source.match(regGetInject);

    //注入格式：
    // services.inject(this, 'cache', 'GLOBAL_CONSTANT');
    // this._initialize();

    var injectArr = [];
    var injectObj = {}; //注入去重
    for (var i in injectArrTmp) {
        var item = injectArrTmp[i] || "";

        item = item + "";
        // console.log(item);
        var arr = item.split(/['",]/);
        for (var j = 1; j < arr.length - 1; j++) {
            var word = arr[j].trim();
            if (word && !injectObj[word]) {
                injectObj[word] = true;
                injectArr.push(word);
            }
        }
    }
    // console.log(injectArr)
    return injectArr;
}

/**
 * 替换老的注入方式为新的注入方式
 * @param source
 * @param injectArr
 * @returns {*}
 * @private
 */
function _replaceInject(source, injectArr) {
    //对新的一行，包含该services.inject(),或者services.inject(XX) 的，作为匹配条件
    var regOldInject = /\n.*?services\.inject\s*\(.*?\).*?\n/g;

    //注入内容需要包裹引号
    var wrapeInjectArr = injectArr.map(function (item, i) {
        return "'" + item + "'";
    });

    // console.log(wrapeInjectArr)
    //第一个字段增加this，并组装字符串
    wrapeInjectArr.unshift("this");
    var newInjectStr = "\n        services.inject(" + wrapeInjectArr.join(", ") + ");\n";
    // console.log(newInjectStr)

    //如果匹配到多个，只替换第一个。
    var matchArr = [];
    var isReplaced = false;
    source = source.replace(regOldInject, function (matchStr, index) {
        matchArr.push(matchStr);

        if (!isReplaced) {
            isReplaced = true;
            return newInjectStr;
        }
        isReplaced = true;
        return "";

    });
    // console.log("outSide:" + isReplaced)
    // console.log(matchArr)
    //如果有匹配到，则将匹配信息写到目的文件
    if (isReplaced) {
        writeMatchInfo(matchArr, newInjectStr);
    }

    return source;
}

/**
 * 将转换后的内容写会文件
 * @param content
 */
function writeResultBack(content) {

    var dstFilePath = that.resourcePath;
    appTools.writeToFile(dstFilePath, content)
}

/**
 * 写匹配的数据信息
 * @param matchArr
 * @param newInjectStr
 */
function writeMatchInfo(matchArr, newInjectStr) {
    if (matchInfoPath) {
        var realPath = path.resolve(contextPath, matchInfoPath);

        var fileStr = "path" + Counter() + ":" + that.resourcePath + "\n";
        fileStr += "src:" + matchArr.join("\n   ");
        fileStr += "\ndst:" + newInjectStr + "\n\n";
        // console.log("==>" +realPath )

        appTools.writeToFile(realPath, fileStr, appendNum);
        appendNum++;
    }

}

/**
 * 写出替换了哪些字符串
 * @param matchArr
 */
function writeVariableInfo(matchArr) {
    //1、fileName
    //2、index + content
    var srcFilePath = that.resourcePath;
    var srcFileDirname = path.dirname(srcFilePath);
    var srcFileName = path.basename(srcFilePath, ".js");

    var dstFileName = srcFileName + ".replaceInfo.js";
    var dstFilePath = path.resolve(srcFileDirname, dstFileName);

    var context = srcFilePath + "\n\n";
    context += matchArr.map(function (item, i) {
        return (i + 1) + ":" + item;
    }).join("\n");

    appTools.writeToFile(dstFilePath, context);
};

/**
 * 计数用
 * @returns {Function}
 * @private
 */
function _counter() {

    //赋初值
    var count = 0;

    //外部调用时形成闭包
    return function () {
        return ++count;
    }
}
