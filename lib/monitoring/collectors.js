//
// Define new statistics that Monitor can track by adding to this file. Each class should have:
//
// - stats, a member which implements the standard interface found in stats.js
// - start(context, args), optional, called when execution of the instrumented code is about to start
// - end(context, result), optional, called when the instrumented code finishes executing 
//
// Defining .disableIntervalCollection and .disableCumulativeCollection to the collection of per-interval
// and overall statistics respectively.
// 

/*jslint sub:true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var stats = require('../stats');
var Histogram = stats.Histogram;
var Peak = stats.Peak;
var ResultsCounter = stats.ResultsCounter;
var Rate = stats.Rate;
var Uniques = stats.Uniques;
var Accumulator = stats.Accumulator;
var LogFile = stats.LogFile;
var StatsCollectors = exports;
} else {
var StatsCollectors = {};
}

/** Track the runtime of an operation, storing stats in a stats.js#Histogram  */
StatsCollectors['runtime'] = StatsCollectors['latency'] = function RuntimeCollector(params) {
    var self = this;
    self.stats = new Histogram(params);
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
};

/** Track HTTP response codes, storing stats in a stats.js#ResultsCounter object. The client must call 
.end({res: http.ClientResponse}). */
StatsCollectors['result-codes'] = function ResultCodesCollector() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
};

/** Track requests per second, storing stats in a stats.js#Rate object. The client must call 
.end({res: http.ClientResponse}). */
StatsCollectors['rps'] = function RpsCollector() {
    var self = this;
    self.stats = new Rate();
    self.end = function(context, http) { self.stats.put(); };
};

/** Track a status code that is returned in an HTTP header, storing stats in a stats.js#ResultsCounter
object. The client must call .end({res: http.ClientResponse}). */
StatsCollectors['header-code'] = function HeaderCodeCollector(params) {
    if (!params.header) { throw new Error('"header" is a required parameter for header-code'); }
    var self = this, header = params.header.toLowerCase(), regex = params.regex;
    self.stats = new ResultsCounter();
    self.end = function(context, http) {
        var val = http.res.headers[header];
        if (regex && val !== undefined) {
            val = val.match(regex);
            val = val && val[1] || undefined;
        }
        if (val !== undefined) { self.stats.put(val); }
    };
};

/** Track the concurrent executions (ie. stuff between calls to .start() and .end()), storing in a 
stats.js#Peak. */
StatsCollectors['concurrency'] = function ConcurrencyCollector() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
};

/** Track the size of HTTP request bodies sent by adding up the content-length headers. This function
doesn't really work as you'd hope right now, since it doesn't work for chunked encoding messages and 
doesn't return actual bytes over the wire (headers, etc). */
StatsCollectors['request-bytes'] = function RequestBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req) {
            if (http.req._header) { self.stats.put(http.req._header.length); }
            if (http.req.body) { self.stats.put(http.req.body.length); }
        }
    };
};

/** Track the size of HTTP response bodies. It doesn't account for headers! */
StatsCollectors['response-bytes'] = function ResponseBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) { 
        if (http && http.res) { 
            http.res.on('data', function(chunk) {
                self.stats.put(chunk.length);
            });
        }
    };
};

/** Track unique URLs requested, storing stats in a stats.js#Uniques object. The client must call 
Monitor.start({req: http.ClientRequest}). */
StatsCollectors['uniques'] = function UniquesCollector() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
};
StatsCollectors['uniques'].disableIntervalCollection = true; // Per-interval stats should be not be collected

/** Track number HTTP response codes that are considered errors. Can also log request / response 
information to disk when an error response is received. Specify the acceptable HTTP status codes in
params.successCodes. Specify the log file name in params.log, or leave undefined to disable logging. */
StatsCollectors['http-errors'] = function HttpErrorsCollector(params) {
    var self = this;
    self.stats = new Accumulator();
    self.successCodes = params.successCodes || [200];
    self.logfile = (typeof params.log === 'string') ? new LogFile(params.log) : params.log;
    self.logResBody = ( params.hasOwnProperty('logResBody') ) ? params.logResBody : true;
    self.end = function(context, http) {
        if (self.successCodes.indexOf(http.res.statusCode) < 0) {
            self.stats.put(1);

            if (self.logfile) {
                util.readStream(http.res, function(body) {
                    var logObj = { ts: new Date(), 
                        req: {
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers
                        }
                    };
                    if (self.logResBody) {
                        logObj.res.body = body;
                    }
                    self.logfile.put(JSON.stringify(logObj) + '\n');
                });
            }
        }
    };
};
StatsCollectors['http-errors'].disableIntervalCollection = true; // Per-interval stats should be not be collected

/** Track number HTTP response codes that are considered errors. Can also log request / response 
information to disk when an error response is received. Specify the acceptable HTTP status codes in
params.successCodes. Specify the log file name in params.log, or leave undefined to disable logging. */
StatsCollectors['slow-responses'] = function HttpErrorsCollector(params) {
    var self = this;
    self.stats = new Accumulator();
    self.threshold = params.threshold || 1000;
    self.logfile = (typeof params.log === 'string') ? new LogFile(params.log) : params.log;
    self.logResBody = ( params.hasOwnProperty('logResBody') ) ? params.logResBody : true;
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context, http) {
        var runTime = new Date() - context.start;
        if (runTime > self.threshold) {
            self.stats.put(1);

            if (self.logfile) {
                util.readStream(http.res, function(body) {
                    var logObj = { ts: new Date(), 
                        req: {
                            // Use the _header "private" member of http.ClientRequest, available as of 
                            // node v0.2.2 (9/30/10). This is the only way to reliably get all request
                            // headers, since ClientRequest adds headers beyond what the user specifies
                            // in certain conditions, like Connection and Transfer-Encoding. 
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers
                        },
                        latency: runTime
                    };
                    if (self.logResBody) {
                        logObj.res.body = body;
                    }
                    self.logfile.put(JSON.stringify(logObj) + '\n');
                });
            }
        }
    };
};
StatsCollectors['slow-responses'].disableIntervalCollection = true; // Per-interval stats should be not be collected