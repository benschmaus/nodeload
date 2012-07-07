/*jslint forin:true */

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var child_process = require('child_process');
var REPORT_MANAGER = require('./reportmanager').REPORT_MANAGER;
var util = require('../util');
var path = require('path');
}

var monitorProcess;

var monitorJmx = exports.monitorJmx = function(options) {
  // Verify that java & jmxstat jar can be found. Search for jmxstat/jmxstat.jar located next to the
  // current module or a parent module that included it.
  var m = module;
  var jmxstat, found = false;
  while (m && !found) {
    jmxstat = path.join(path.dirname(m.filename), 'jmxstat/jmxstat.jar');
    found = fs.existsSync(jmxstat);
    m = m.parent;
  }
  if (!found) {
    throw new Error('jmxstat/jmxstat.jar not found.');
  }
  
  // Build command line args, output regex, and field labels
  var regex = '\\d{2}:\\d{2}:\\d{2}', columns = [], mbeans = [];
  for (var mbean in options.mbeans) {
    regex += '\\t([^\\t]*)';
    columns.push(mbean);
    mbeans.push(options.mbeans[mbean]);
  }
    
  // Start jmxstat
  var interval = options.interval || '';
  return monitorProcess({
    command: 'java -jar ' + jmxstat + ' ' + options.host + ' ' + mbeans.join(' ') + ' ' + interval,
    columns: columns,
    regex: regex,
    dataFormatter: options.dataFormatter
  });
};
var graphJmx = exports.graphJmx = function(options) {
  var report = REPORT_MANAGER.getReport(options.reportName || options.host || 'Monitor'),
      graph = report.getChart(options.chartName || 'JMX'),
      jmx = monitorJmx(options);

  jmx.on('data', function (data) { graph.put(data); });
  return jmx;
};

/** Spawn a child process, extract data using a regex, and graph the results on the summary report.
Returns a standard ChildProcess object.
*/
var monitorProcess = exports.monitorProcess = function(options) {
  var delimiter = options.delimiter || ' +',
    columns = options.columns || [],
    fieldRegex = columns.map(function() { return '([0-9.e+-]+)'; }).join(delimiter), // e.g. ([0-9.e+-]*) +([0-9.e+-]*) +...
    regex = options.regex || ('^ *' + fieldRegex),
    splitIdx = columns.indexOf(options.splitBy) + 1;

  var valuesToNumber = function(o) { 
    for (var i in o) {
      o[i] = Number(Number(o[i]).toFixed(2));
    }
    return o; 
  };

  var format = options.dataFormatter || valuesToNumber;
  var proc = child_process.spawn('/bin/bash', ['-c', options.command], options.spawnOptions),
    lr = new util.LineReader(proc.stdout);
  
  lr.on('data', function (line) {
    var vals = line.match(regex);
    if (vals) {
      var obj = {}, prefix = '';
      if (splitIdx > 0 && vals[splitIdx]) {
        prefix = vals[splitIdx] + ' ';
      }
      for (var i = 1; i < vals.length; i++) {
        if (columns[i-1]) {
          obj[prefix + columns[i-1]] = vals[i];
        }
      }
      obj = format(obj);
      if (obj) { proc.emit('data', obj); }
    }
  });

  return proc;
};
var graphProcess = exports.graphProcess = function(options) {
  var report = REPORT_MANAGER.getReport(options.reportName || 'Monitor'),
      graph = report.getChart(options.chartName || options.command),
      proc = monitorProcess(options);
  
  proc.on('data', function (data) { graph.put(data); });
  return proc;
};