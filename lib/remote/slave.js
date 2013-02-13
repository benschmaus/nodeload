/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var EndpointClient = require('./endpointclient').EndpointClient;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** Slave represents a remote slave instance from the master server's perspective. It holds the slave
method defintions, defined by calling defineMethod(), as Javascript strings. When start() is called,
the definitions are POSTed to /remote on the remote instance which causes the instance to create a new
endpoint with those methods. Subsequent calls to Slave simply POST parameters to the remote instance:

    slave = new Slave(...);
    slave.defineMethod('slave_method_1', function(master, name) { return 'hello ' + name });
    slave.start();
    slave.on('start', function() {
        slave.method_1('tom');
        slave.end();
    });

will POST the definition of method_1 to /remote, followed by ['tom'] to /remote/.../method_1.

Slave emits the following events:
- 'slaveError', error: The underlying HTTP connection returned an error.
- 'start': The remote instance accepted the slave definition and slave methods can now be called.
- 'end': The slave endpoint has been removed from the remote instance.

Slave.state can be:
- 'initialized': The slave is ready to be started.
- 'connecting': The slave definition is being sent to the remote instance.
- 'started': The remote instance is running and methods defined through defineMethod can be called. */
var Slave = exports.Slave = function Slave(id, host, port, masterEndpoint, pingInterval) {
    EventEmitter.call(this);
    this.id = id;
    this.client = new EndpointClient(host, port);
    this.client.on('error', this.emit.bind(this, 'slaveError'));
    this.masterEndpoint = masterEndpoint;
    this.pingInterval = pingInterval || NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
    this.methodDefs = [];
    this.state = 'initialized';
};
util.inherits(Slave, EventEmitter);
/** POST method definitions and information about this instance (the slave's master) to /remote */
Slave.prototype.start = function() {
    if (this.masterEndpoint && this.masterEndpoint.state !== 'started') {
        throw new Error('Slave must be started after its Master.');
    }

    var self = this,
        masterUrl = self.masterEndpoint ? self.masterEndpoint.url : null,
        masterMethods = self.masterEndpoint ? self.masterEndpoint.methodNames : [],
        req = self.client.rawRequest('POST', '/remote');

    req.end(JSON.stringify({
        id: self.id,
        master: masterUrl,
        masterMethods: masterMethods,
        slaveMethods: self.methodDefs,
        pingInterval: self.pingInterval
    }));
    req.on('response', function(res) {
        if (!res.headers['location']) {
            self.emit('error', new Error('Remote slave does not have proper /remote handler.'));
        }
        self.client.basepath = url.parse(res.headers['location']).pathname;
        self.state = 'started';
        self.emit('start');
    });

    self.state = 'connecting';
};
/** Stop this slave by sending a DELETE request to terminate the slave's endpoint. */
Slave.prototype.end = function() {
    var self = this,
        req = self.client.rawRequest('DELETE', self.client.basepath),
        done = function() {
            self.client.basepath = '';
            self.state = 'initialized';
            self.emit('end');
        };

    self.client.once('error', function(e) {
        self.emit('slaveError', e);
        done();
    });
    req.on('response', function(res) {
        if (res.statusCode !== 204) {
            self.emit('slaveError', new Error('Error stopping slave.'), res);
        }
        done();
    });
    req.end();
};
/** Define a method that will be sent to the slave instance */
Slave.prototype.defineMethod = function(name, fun) {
    var self = this;
    self.client.defineMethod(name, fun);
    self[name] = function() { return self.client[name].apply(self.client, arguments); };
    self.methodDefs.push({name: name, fun: fun.toString()});
};
