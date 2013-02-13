var _ = require('underscore'),
    request = require('superagent'),
    url = require('url'),
    fs = require('fs'),
    async = require('async'),
    temp = require('temp'),
    zlib = require('zlib'),
    querystring = require('querystring'),
    traverse = require('traverse');
    
_.str = require('underscore.string');
_.mixin(_.str);

exports.request = function(options, next) {
    var self = this;
    options.headers = options.headers || {};
    if (this.attrs.headers) {
        _(options.headers).extend(this.attrs.headers);
    }

    // Build a static JSON object from the options hash by invoking
    // any dynamic value functions.
    options = traverse(options).clone();
    traverse(options).forEach(function(value) {
        if (_(value).isFunction()) {
            this.update(value.call(self, options));
        }
    });

    if (!this.runData.requests) {
        this.runData.requests = [];
    }
    this.runData.requests.push(options);

    options.protocol = 'http';
    options.pathname = options.path;
    options.hostname = options.hostname || this.attrs.hostname;
    options.port = options.port || this.attrs.port;
    var req = request(options.method, url.format(options)).set(options.headers);

    if (options.body) {
        var content;
        if (options.body.json) {
            // This is a total hack to deal with the fact that the API accepts this
            // bizarre urlencoded json string within a json object format. I'm sorry.
            var isV2 = options.path.indexOf('/v2') > 1,
                payload = JSON.stringify(options.body.json);
            content = querystring.stringify(isV2? {data: payload} : {json: payload});

        } else {
            content = options.body; // wouldn't it be nice if it worked this way...
        }
        req.type('json').send(content);
    }
    req.end(function(res) {
        // Deal with the fact that sometimes, we get text/html as the
        // content type... sigh...
        if (res.type === 'text/html') {
            res.body = JSON.parse(res.text);
        }

        // Deal with the possibility of receiving errors via 200
        // response and fudge the status code to give us meaningful
        // data in our reports.
        if (res.status == 200 && res.body.error) {
            res.status = 500;
            res.res.statusCode = 500;
        }

        if (res.status !== 200) { // TODO: Probably get ride of this
            console.log("Error: " + res.status);
            console.log(res.body);
        }

        options.response = res.body;
        next(res);
    });
};

// Sets the hostname and port (port optional)
exports.host = function(hostname, port, next) {
    if (arguments.length === 2) {
        next = port;
        port = 80;
    }

    this.attrs.hostname = hostname;
    this.attrs.port = port;
    next();
};

exports.headers = function(headers, next) {
    this.attrs.headers = this.attrs.headers || {};
    _(this.attrs.headers).extend(headers);
    next();
};


_(['get', 'post', 'put', 'delete']).each(function(verb) {
    exports[verb] = function(path, next) {
        // Sort out args - we also accept path inserts and an options hash
        // The last arg is always the "next" callback
        var options = {};
        var pathInserts = [];
        _.chain(arguments).rest().initial().each(function(arg) {
            if (_(arg).isFunction()) {
                pathInserts.push(arg);
            } else {
                options = arg;
            }
        });
        next = _(arguments).last();
        options.method = verb.toUpperCase();

        // If there were path inserts, we need to make path a function.
        if (pathInserts.length > 0) {
            options.path = function() {
                var args = [path];
                // Allow path inserts to be functions
                args = args.concat(_(pathInserts).map(function(insert) {
                    if (_(insert).isFunction()) {
                        return insert();
                    }
                    return insert;
                }));
                return _.sprintf.apply(this, args);
            };
        } else {
            options.path = path;
        }
        exports.request.call(this, options, next);
    };
});

exports.install = function(Program) {
    _(['get', 'post', 'put', 'delete']).each(function(method) {
        Program.registerInterpreter(method, exports[method], true);
    });
    _(['headers', 'host']).each(function(method) {
        Program.registerInterpreter(method, exports[method], false);
    });
};
