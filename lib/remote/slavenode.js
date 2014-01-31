var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var qputs = util.qputs;
var Endpoint = require('./endpoint').Endpoint;
var EndpointClient = require('./endpointclient').EndpointClient;
var EventEmitter = require('events').EventEmitter;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
var Program = require('../user/program.js').Program;
}

/** An instance of SlaveNode represents a slave from the perspective of a slave (as opposed to
slave.js#Slave, which represents a slave from the perspective of a master). When a slave.js#Slave object
is started, it sends a slave specification to the target machine, which uses the specification to create
a SlaveNode. The specification contains:

    {
        id: master assigned id of this node,
        master: 'base url of master endpoint, e.g. /remote/0',
        masterMethods: ['list of method name supported by master'],
        slaveMethods: [
            { name: 'method-name', fun: 'function() { valid Javascript in a string }' }
        ],
        pingInterval: milliseconds between sending the current execution state to master
    }

If the any of the slaveMethods contain invalid Javascript, this constructor will throw an exception.

SlaveNode emits the following events:
- 'start': The endpoint has been installed on the HTTP server and connection to the master has been made
- 'masterError': The HTTP connection to the master node returned an error.
- 'end': The local endpoint has been removed and the connection to the master server terminated
*/
var SlaveNode = exports.SlaveNode = function SlaveNode(server, spec) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var self = this, slaveState = 'initialized';
    this.id = spec.id;
    this.masterClient_ = spec.master ? this.createMasterClient_(spec.master, spec.masterMethods) : null;
    this.slaveEndpoint_ = this.createEndpoint_(server, spec.slaveMethods);
    this.slaveEndpoint_.setStaticParams([this.masterClient_]);
    this.slaveEndpoint_.on('start', function() { this.emit.bind(this, 'start'); });
    this.slaveEndpoint_.on('end', this.end.bind(this));

    this.slaveEndpoint_.start();
    this.slaveEndpoint_.context.id = this.id;
    this.slaveEndpoint_.context.__defineGetter__('state', function() { return slaveState; });
    this.slaveEndpoint_.context.__defineSetter__('state', function(val) {
        slaveState = val;
        self.update();
    });
    this.url = this.slaveEndpoint_.url;

    this.updateInterval = (spec.pingInterval >= 0) ? spec.pingInterval : NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
};
util.inherits(SlaveNode, EventEmitter);
SlaveNode.prototype.end = function() {
    this.updateInterval = 0;
    this.slaveEndpoint_.end();
    this.emit('end');
};
SlaveNode.prototype.update = function() {
    if (this.masterClient_) {
        this.masterClient_.updateSlaveState_(this.slaveEndpoint_.context.state);
    }
};
SlaveNode.prototype.createEndpoint_ = function(server, methods) {
    // Add a new endpoint and route to the HttpServer
    var endpoint = new Endpoint(server);

    // "Compile" the methods by eval()'ing the string in "fun", and add to the endpoint
    if (methods) {
        try {
            methods.forEach(function(m) {
                var fun;
                eval('fun=' + m.fun);
                endpoint.defineMethod(m.name, fun);
            });
        } catch (e) {
            endpoint.end();
            endpoint = null;
            throw e;
        }
    }

    return endpoint;
};
SlaveNode.prototype.createMasterClient_ = function(masterUrl, methods) {
    var parts = url.parse(masterUrl),
        masterClient = new EndpointClient(parts.hostname, Number(parts.port) || 8000, parts.pathname);

    masterClient.defineMethod('updateSlaveState_');
    if (methods && methods instanceof Array) {
        methods.forEach(function(m) { masterClient.defineMethod(m); });
    }

    // send this slave's id as the first parameter for all method calls to master
    masterClient.setStaticParams([this.id]);

    masterClient.on('error', this.emit.bind(this, 'masterError'));
    return masterClient;
};


/** Install the /remote URL handler, which creates a slave endpoint. On receiving a POST request to
/remote, a new route is added to HTTP_SERVER using the handler definition provided in the request body.
See #SlaveNode for a description of the handler defintion. */
var installRemoteHandler = exports.installRemoteHandler = function(server) {
    var slaveNodes = [];
    server.addRoute('^/remote/?$', function(path, req, res) {
        if (req.method === 'POST') {
            util.readStream(req, function(body) {
                var slaveNode;

                // Grab the slave endpoint definition from the HTTP request body; should be valid JSON
                try {
                    body = JSON.parse(body);
                    slaveNode = new SlaveNode(server, body);
                } catch(e) {
                    res.writeHead(400);
                    res.end(e.toString());
                    return;
                }

                slaveNodes.push(slaveNode);
                slaveNode.on('end', function() {
                    var idx = slaveNodes.indexOf(slaveNode);
                    if (idx !== -1) { slaveNodes.splice(idx, 1); }
                });

                res.writeHead(201, {
                    'Location': slaveNode.url,
                    'Content-Length': 0,
                });
                res.end();
            });
        } else if (req.method === 'GET') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(slaveNodes.map(function(s) { return s.url; })));
        } else {
            res.writeHead(405);
            res.end();
        }
    });
};
