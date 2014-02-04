**This page is out of date**

TIPS AND TRICKS
================

Some handy features of `nodeload` worth mentioning.

1. **Examine and add to stats to the HTML page:**

    addTest().stats and runTest().stats are maps:

        { 'latency': Reportable(Histogram), 
          'result-codes': Reportable(ResultsCounter},
          'uniques': Reportable(Uniques), 
          'concurrency': Reportable(Peak) }
     
    Put `Reportable` instances to this map to have it automatically updated each reporting interval and added to the summary webpage.

2. **Post-process statistics:**

    Use a `startTests()` callback to examine the final statistics in `test.stats[name].cumulative` at test completion.

        // GET random URLs of the form localhost:8080/data/object-#### for 10 seconds, then
        // print out all the URLs that were hit.
        var t = addTest({
            timeLimit: 10,
            targetRps: 10,
            stats: ['uniques'],
            requestGenerator: function(client) {
                return traceableRequest(client, 'GET', '/data/object-' + Math.floor(Math.random()*100));;
            }
        });
        function printAllUrls() {
            console.log(JSON.stringify(t.stats['uniques'].cumulative));
        }
        startTests(printAllUrls);
        

3. **Out-of-the-box file server:**

    Just start `nodeloadlib.js` and it will serve files in the current directory.
    
        $ node lib/nodeloadlib.js
        $ curl -i localhost:8000/lib/nodeloadlib.js     # executed in a separate terminal
        HTTP/1.1 200 OK
        Content-Length: 50763
        Connection: keep-alive
        
        var util = require('util');
        var http = require('http');
        ...

4. **Run arbitrary Javascript:**

    POST any valid Javascript to `/remote` to have it `eval()`'d.
    
        $ node dist/nodeloadlib.js
        Serving progress report on port 8000.
        Opening log files.
        Received remote command:
        util.puts("hello!")
        hello!
        
        $ curl -i -d 'util.puts("hello!")' localhost:8000/remote     # executed in a separate terminal
