// ------------------------------------
// Distributed Load Testing Interface
// ------------------------------------
//
// This file defines LoadTestCluster.
//
// This file defines the interface for distributing a load test across multiple machines. Load tests are
// defined through a specification identical to those used by loadtesting.js#run(). To run a distributed
// test, first start nodeload on the slave machines, then initiate the test from the master.
//
//      remote-slave-1> nodeload.js
//      Started HTTP server on remote-slave-1:8000.
//
//      remote-slave-2> nodeload.js
//      Started HTTP server on remote-slave-2:8000.
//
//      master> edit remote-test.js
//          # var nl = require('nodeload');
//          # var cluster = new nl.LoadTestCluster('master:8000', ['remote-slave-1:8000', 'remote-slave-2:8000']);
//          # cluster.run({ ... test specification ... });
//
// See examples/remotetesting.ex.js for a full example.
//
/*jslint forin:true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var stats = require('../stats');
var reporting = require('../reporting');
var run = require('../loadtesting').run;
var Cluster = require('./cluster').Cluster;
var EventEmitter = require('events').EventEmitter;
var StatsLogger = require('../monitoring/statslogger').StatsLogger;
var Report = reporting.Report;
var qputs = util.qputs;

var REPORT_MANAGER = reporting.REPORT_MANAGER;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** A LoadTestCluster consists of a master and multiple slave instances of nodeload. Use
LoadTestCluster.run() accepts the same parameters as loadtesting.js#run(). It runs starts the load test
on each of slaves and aggregates statistics from each of them.

@param masterHost 'host:port' to use for slaves to communicate with this nodeload instance.
@param slaveHosts ['host:port', ...] of slave nodeload instances
@param masterHttpServer the http.js#HttpServer instance that will receive mesages from slaves. Defaults
        to global HTTP_SERVER.
@param slaveUpdateInterval Number of milliseconds between each 'update' event (which contains the latest
        statistics) from this cluster and also the the interval at which each slaves should ping us to
        let us know it is still alive.

LoadTestCluster emits the following events:
- 'start': All of the slaves have started executing the load test after a call to run()
- 'update', interval, stats: Emitted periodically with aggregate stats from the last interval and overall stats
- 'end': All of the slaves have completed executing the load test
*/
var LoadTestCluster = exports.LoadTestCluster = function LoadTestCluster(masterHost, slaveHosts, masterHttpServer, slaveUpdateInterval) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var self = this;
    self.masterHost = masterHost;
    self.slaveHosts = slaveHosts;
    self.masterHttpServer = self.masterHttpServer;
    self.slaveUpdateInterval = slaveUpdateInterval || NODELOAD_CONFIG.MONITOR_INTERVAL_MS;
};
util.inherits(LoadTestCluster, EventEmitter);
/** Same parameters as loadtesting.js#run(). Start a load test on each slave in this cluster */
LoadTestCluster.prototype.run = function(specs) {
    var self = this;
    if (!specs) { throw new Error('No tests.'); }
    if (self.cluster && self.cluster.started()) { throw new Error('Already started.'); }

    self.specs = (specs instanceof Array) ? specs : util.argarray(arguments);
    self.cluster = new Cluster(self.getClusterSpec_());
    self.cluster.on('init', function() {
        self.cluster.on('start', function() {
            self.startTests_();
            self.updateInterval = self.slaveUpdateInterval;
            self.setLoggingEnabled(NODELOAD_CONFIG.LOGS_ENABLED);
        });
        self.cluster.start();
    });
    self.cluster.on('running', function() {
        self.emit('start');
    });
    self.cluster.on('done', function() {
        self.setLoggingEnabled(false);
        self.updateInterval = 0;
        self.update();
        self.end();
    });
    self.cluster.on('end', function() {
        self.emit('end');
    });
};
/** Force all slaves to stop running tests */
LoadTestCluster.prototype.end = function() {
    this.cluster.stopTests();
    this.cluster.end();
};
/** Set the file name or stats.js#LogFile object that statistics are logged to; null for default */
LoadTestCluster.prototype.setLogFile = function(logNameOrObject) {
    this.logNameOrObject = logNameOrObject;
};

/** Log statistics each time an 'update' event is emitted */
LoadTestCluster.prototype.setLoggingEnabled = function(enabled) {
    if (enabled) {
        this.logger = this.logger || new StatsLogger(this, this.logNameOrObject).start();
    } else if (this.logger) {
        this.logger.stop();
        this.logger = null;
    }
    return this;
};
/** Emit an 'update' event, add latest to the reports, and clear out stats for next interval */
LoadTestCluster.prototype.update = function() {
    var self = this;
    self.emit('update', self.interval, self.stats);
    util.forEach(self.stats, function(testName, stats) {
        var report = self.reports[testName];
        var interval = self.interval[testName];
        util.forEach(stats, function(statName, stat) {
            util.forEach(stat.summary(), function(name, val) {
                report.summary[testName + ' ' + statName + ' ' + name] = val;
            });
            report.getChart(statName).put(interval[statName].summary());
        });
    });
    util.forEach(self.interval, function(testName, stats) {
        util.forEach(stats, function(statName, stat) {
            stat.clear();
        });
    });
    util.qprint('.');
};
LoadTestCluster.prototype.startTests_ = function() {
    var self = this,
        summarizeStats = function() {
            var summary = {ts: new Date()};
            util.forEach(this, function(testName, stats) {
                summary[testName] = {};
                util.forEach(stats, function(statName, stat) {
                    summary[testName][statName] = stat.summary();
                });
            });
            return summary;
        };

    this.reports = {};
    this.interval = {};
    this.stats = {};
    this.cluster.runTests(this.stringify_(this.specs));

    Object.defineProperty(this.stats, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
    Object.defineProperty(this.interval, 'summary', {
        enumerable: false,
        value: summarizeStats
    });
};
/** A custom JSON stringifier that outputs node-compatible JSON which includes functions. */
LoadTestCluster.prototype.stringify_ = function(obj) {
    switch (typeof obj) {
    case 'function':
        return obj.toString();
    case 'object':
        if (obj instanceof Array) {
            var self = this;
            return ['[', obj.map(function(x) { return self.stringify_(x); }), ']'].join('');
        } else if (obj === null) {
            return 'null';
        }
        var ret = ['{'];
        for (var i in obj) {
            ret.push(i + ':' + this.stringify_(obj[i]) + ',');
        }
        ret.push('}');
        return ret.join('');
    case 'number':
        if (isFinite(obj)) {
            return String(obj);
        }
        return 'Infinity';
    default:
        return JSON.stringify(obj);
    }
};
/** Get an actual cluster.js#Cluster definition that will create an local master endpoint and be sent
to the slaves */
LoadTestCluster.prototype.getClusterSpec_ = function() {
    var self = this;
    return {
        master: {
            host: self.masterHost,
            sendStats: function(slaves, slaveId, interval) {
                // slave sends interval = {"test-name": { "stats-name": StatsObject, ...}, ...}
                util.forEach(interval, function(testName, remoteInterval) {
                    if (!self.stats[testName]) {
                        // First time seeing this test. Create cumulative and interval stats and a report.
                        self.stats[testName] = {};
                        self.interval[testName] = {};
                        self.reports[testName] = new Report(testName);
                        REPORT_MANAGER.addReport(self.reports[testName]);
                    }

                    // Merge in data from each stat (e.g. latency, result-codes, etc) from this slave
                    stats.mergeStatsGroups(remoteInterval, self.interval[testName]);
                    stats.mergeStatsGroups(remoteInterval, self.stats[testName]);
                });
            }
        },
        slaves: {
            hosts: self.slaveHosts,
            setup: function() {
                if (typeof BUILD_AS_SINGLE_FILE === 'undefined' || BUILD_AS_SINGLE_FILE === false) {
                    this.nlrun = require('../loadtesting').run;
                } else {
                    this.nlrun = run;
                }
            },
            runTests: function(master, specsStr) {
                var specs;
                try {
                    eval('specs='+specsStr);
                } catch(e) {
                    qputs('WARN: Ignoring invalid remote test specifications: ' + specsStr + ' - ' + e.toString());
                    return;
                }

                if (this.state === 'running') {
                    qputs('WARN: Already running -- ignoring new test specifications: ' + specsStr);
                    return;
                }

                qputs('Received remote test specifications: ' + specsStr);

                var self = this;
                self.state = 'running';
                self.loadtest = self.nlrun(specs);
                self.loadtest.keepAlive = true;
                self.loadtest.on('update', function(interval, stats) {
                    master.sendStats(interval);
                });
                self.loadtest.on('end', function() {
                    self.state = 'done';
                });
            },
            stopTests: function(master) {
                if (this.loadtest) { this.loadtest.stop(); }
            }
        },
        server: self.masterHttpServer,
        pingInterval: self.slaveUpdateInterval
    };
};
