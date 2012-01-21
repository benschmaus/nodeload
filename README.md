INSTALLING
================

Make sure [node.js](http://nodejs.org/#download) is installed. Then install `nodeload`:

1. Using [npm](http://npmjs.org/):

        curl http://npmjs.org/install.sh | sh       # install npm if not already installed
        npm install nodeload

2. From source:

        git clone git://github.com/benschmaus/nodeload.git
        cd nodeload
        npm link    # optional. enables require('nodeload/<module>') instead of require('./lib/<module>').

3. Or as a single file (this does not install the `nl.js` tool):

        wget https://github.com/benschmaus/nodeload/raw/master/nodeload.js

NODELOAD
================

`nodeload` is a collection of independent [node.js](http://nodejs.org/) modules for load testing HTTP services.

As a developer, you should be able to write load tests and get informative reports without having to learn another framework. You should be able to build by example and selectively use the parts of a tool that fit your task. Being a library means that you can use as much or as little of `nodeload` as makes sense, and you can create load tests with the power of a full programming language. For example, if you need to execute some function at a given rate, just use the [`'nodeload/loop'`](https://github.com/benschmaus/nodeload/tree/master/doc/loop.md) module, and write the rest yourself.

In addition, `nodeload` is built for operability. It can always be deployed by simply copying the single file, `nodeload.js`.

Look for examples in the [`examples/`](https://github.com/benschmaus/nodeload/tree/master/examples) directory and in test cases prefixed with "example" in [`test/`](https://github.com/benschmaus/nodeload/tree/master/test). Here are simple examples of each module:

### [nl](https://github.com/benschmaus/nodeload/tree/master/doc/nl.md)

`nl` is an [Apache Bench (ab)](http://httpd.apache.org/docs/2.0/programs/ab.html) like command line tool for running tests quickly. See the [nl documentation](https://github.com/benschmaus/nodeload/tree/master/doc/nl.md) for details.

    $ examples/test-server.js &    # starts a simple server on port 9000 to load test
    $ ./nl.js -c 10 -n 10000 -i 2 localhost:9000

will send 10,000 queries to http://localhost:9000 using 10 connections. Statistics are printed to the console and graphs can be seen at <http://localhost:8000/>.

### [nodeload](https://github.com/benschmaus/nodeload/tree/master/doc/nodeload.md)

The `nodeload` module is the primary interface for creating load tests. It includes all the other modules described below, so if you `require('nodeload')`, you don't need to `require()` any of the other ones. Look at the examples in [`examples/loadtesting.ex.js`](https://github.com/benschmaus/nodeload/tree/master/examples/loadtesting.ex.js) and [`examples/riaktest.ex.js`](https://github.com/benschmaus/nodeload/tree/master/examples/riaktest.ex.js) or read the [nodeload module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/nodeload.md).

    var nl = require('nodeload');
    var loadtest = nl.run({
        host: 'localhost',
        port: 9000,
        timeLimit: 60,
        targetRps: 500,
        requestGenerator: function(client) {
            var request = client.request('GET', "/" + Math.floor(Math.random()*10000));
            request.end();
            return request;
        }
    });
    loadtest.on('end', function() { console.log('Load test done.'); });

### [remote](https://github.com/benschmaus/nodeload/tree/master/doc/remote.md)

The `remote` module provides a mechanism for running a distributed load test. See [`examples/remotetesting.ex.js`](https://github.com/benschmaus/nodeload/tree/master/examples/remotetesting.ex.js) and [`examples/remote.ex.js`](https://github.com/benschmaus/nodeload/tree/master/examples/remote.ex.js) for examples or read the [remote module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/remote.md).

Start slave instances:

    $ HTTP_PORT=10001 ./nodeload.js  # start a local slave instance on :10001
    $ HTTP_PORT=10002 ./nodeload.js  # start a 2nd slave instance on :10002
    
Create the distributed load test:

    var nl = require('nodeload/remote');
    var cluster = new nl.LoadTestCluster('localhost:8000', ['localhost:8002', 'localhost:8001']);
    cluster.run({
        host: 'localhost',
        port: 9000,
        timeLimit: 60,
        targetRps: 500,
        requestGenerator: function(client) {
            var request = client.request('GET', "/" + Math.floor(Math.random()*10000));
            request.end();
            return request;
        }
    });
    cluster.on('end', function() { console.log('Load test done.'); });

### [stats](https://github.com/benschmaus/nodeload/tree/master/doc/stats.md)

The `stats` module provides implementations of various statistics objects, like Histograms and Accumulators, and functions, like randomString(), and nextGaussian(). See the [stats module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/stats.md).

    var stats = require('nodeload/stats');
    var histogram = new stats.Histogram();
    for (var i = 0; i < 1000; i++) 
        histogram.put(Math.abs(Math.floor(stats.nextGaussian())));
    console.log('Mean: ' + histogram.mean() + ', 99%: ' + histogram.percentile(0.99));

will output "`Mean: 0.852, 99%: 3`".

### [monitoring](https://github.com/benschmaus/nodeload/tree/master/doc/monitoring.md)

The `monitoring` module provides a way to track runtime statistics for code that is run concurrently. See [`test/monitoring.test.js`](https://github.com/benschmaus/nodeload/tree/master/test/monitoring.test.js) for examples or read the [monitoring module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/monitoring.md).

    var monitoring = require('nodeload/monitoring');
    var monitor = new monitoring.Monitor('runtime');
    function asyncFunction() {
        var m = monitor.start();
        setTimeout(function() { m.end(); }, Math.floor(Math.random()*1000));
    }
    for (var i = 0; i < 1000; i++) { asyncFunction(); }
    process.on('exit', function() {
        console.log('Median runtime (ms): ' + monitor.stats['runtime'].percentile(0.5));
    });

will output "`Median runtime (ms): 497`".

### [reporting](https://github.com/benschmaus/nodeload/tree/master/doc/reporting.md)

The `reporting` module provides a way to graph values over time and present it in a auto-updating HTML page. See [`test/reporting.test.js`](https://github.com/benschmaus/nodeload/tree/master/test/reporting.test.js) for examples or read the [reporting module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/reporting.md).

    var reporting = require('nodeload/reporting'), 
        stats = require('nodeload/stats'),
        report = reporting.REPORT_MANAGER.addReport('Random Numbers'),
        chart = report.getChart('Gaussian / Pareto vs. Time (minutes)');
    for (var timeout = 0; timeout < 5000; timeout+=500) {
        setTimeout(function() {
                chart.put({
                    'Pareto': stats.nextPareto(0, 100),
                    'Gaussian': stats.nextGaussian()
                });
            }, timeout);
    }

will display a graph on http://localhost:8000/ and save it to an HTML file in the local directory.

### [loop](https://github.com/benschmaus/nodeload/tree/master/doc/loop.md)

The `loop` module provides a way to execute a function at a set rate and concurrency. See [`test/loop.test.js`](https://github.com/benschmaus/nodeload/tree/master/test/loop.test.js) for examples or read the [loop module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/loop.md) for details.

    var http = require('http'),
        loop = require('nodeload/loop'),
        requests = 0,
        client = http.createClient(80, 'www.google.com'),
        l = new loop.MultiLoop({
            fun: function(finished) { 
                client.request('GET', '/').end();
                requests++;
                finished();
            },
            rps: 10,
            duration: 3,
            concurrency: 5
        }).start();
    l.on('end', function() { console.log('Total requests: ' + requests) });

will output "`Total requests: 30`".

### [http](https://github.com/benschmaus/nodeload/tree/master/doc/http.md)

The `http` module provides a generic HTTP server that serves static files and that can be configured with new routes. See [`test/http.test.js`](https://github.com/benschmaus/nodeload/tree/master/test/http.test.js) for examples or read the [http module documentation](https://github.com/benschmaus/nodeload/tree/master/doc/http.md).

    var http = require('nodeload/http');
    var server = new http.HttpServer().start(10000);
    server.addRoute('^/hello$', function(url, req, res) {
        res.writeHead(200);
        res.end("Hello");
    });

<http://localhost:8000/package.json> will output the contents of `./package.json`, and <http://localhost:10000/resource> will display "Hello".


CONTRIBUTING
================
File bugs on [github](https://github.com/benschmaus/nodeload/issues), email any of the authors, and fork away. [doc/developers.md](https://github.com/benschmaus/nodeload/tree/master/doc/developers.md) has brief instructions on getting tests up and running, and will hold more design details in the future. Contributions are always welcome.
