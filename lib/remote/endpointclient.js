var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var http = require('http');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var qputs = util.qputs;
}

var DEFAULT_RETRY_INTERVAL_MS = 2000;

/** EndpointClient represents an HTTP connection to an Endpoint. The supported methods should be added
by calling defineMethod(...). For example,

    client = new EndpointClient('myserver', 8000, '/remote/0');
    client.defineMethod('method_1');
    client.on('connect', function() {
        client.method_1(args);
    });

will send a POST request to http://myserver:8000/remote/0/method_1 with the body [args], which causes
the Endpoint listening on myserver to execute method_1(args).

EndpointClient emits the following events:
- 'connect': An HTTP connection to the remote endpoint has been established. Methods may now be called.
- 'clientError', Error: The underlying HTTP connection returned an error. The connection will be retried.
- 'clientError', http.ClientResponse: A call to a method on the endpoint returned this non-200 response.
- 'end': The underlying HTTP connect has been terminated. No more events will be emitted.
*/
var EndpointClient = exports.EndpointClient = function EndpointClient(host, port, basepath) {
    EventEmitter.call(this);
    this.host = host;
    this.port = port;
    this.client = util.createReconnectingClient(port, host);
    this.client.on('error', this.emit.bind(this, 'error'));
    this.basepath = basepath || '';
    this.methodNames = [];
    this.retryInterval = DEFAULT_RETRY_INTERVAL_MS;
    this.setStaticParams([]);
};
util.inherits(EndpointClient, EventEmitter);
/** Send an arbitrary HTTP request using the underlying http.Client. */
EndpointClient.prototype.rawRequest = function() {
    return this.client.request.apply(this.client, arguments);
};
EndpointClient.prototype.setStaticParams = function(params) {
    this.staticParams_ = params instanceof Array ? params : [params];
};
/** Add a method that the target server understands. The method can be executed by calling
endpointClient.method(args...). */
EndpointClient.prototype.defineMethod = function(name) {
    var self = this;
    self[name] = function() {
        var req = self.client.request('POST', self.basepath + '/' + name),
            params = self.staticParams_.concat(util.argarray(arguments));

        req.on('response', function(res) {
            if (res.statusCode !== 200) {
                self.emit('clientError', res);
            }
        });
        req.end(JSON.stringify(params));

        return req;
    };
    self.methodNames.push(name);
    return self;
};
