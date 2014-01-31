// -----------------------------------------
// Event-based looping
// -----------------------------------------
// 
// This file defines Loop and MultiLoop.
//
// Nodeload uses the node.js event loop to repeatedly call a function. In order for this to work, the
// function cooperates by accepting a function, finished, as its first argument and calls finished()
// when it completes. This is refered to as "event-based looping" in nodeload.
// 
/*jslint laxbreak: true, undef: true */
/*global setTimeout: false */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
}

/** LOOP_OPTIONS defines all of the parameters that used with Loop.create(), MultiLoop() */
var LOOP_OPTIONS = exports.LOOP_OPTIONS = {
    fun: undefined,                 // A function to execute which accepts the parameters (finished, args).
                                    // The value of args is the return value of argGenerator() or the args
                                    // parameter if argGenerator is undefined. The function must call 
                                    // finished(results) when it completes.
    argGenerator: undefined,             // A function which is called once when the loop is started. The return
                                    // value is passed to fun as the "args" parameter. This is useful when
                                    // concurrency > 1, and each "thread" should have its own args.
    args: undefined,                     // If argGenerator is NOT specified, then this is passed to the fun as
                                    // "args".
    rps: Infinity,                  // Target number of time per second to call fun()
    duration: Infinity,             // Maximum duration of this loop in seconds
    numberOfTimes: Infinity,        // Maximum number of times to call fun()
    concurrency: 1,                 // (MultiLoop only) Number of concurrent calls of fun()
                                    //
    concurrencyProfile: undefined,  // (MultiLoop only) array indicating concurrency over time:
                                    //      [[time (seconds), # users], [time 2, users], ...]
                                    // For example, ramp up from 0 to 100 "threads" and back down to 0 over
                                    // 20 seconds:
                                    //      [[0, 0], [10, 100], [20, 0]]
                                    //
    rpsProfile: undefined           // (MultiLoop only) array indicating execution rate over time:
                                    //      [[time (seconds), rps], [time 2, rps], ...]
                                    // For example, ramp up from 100 to 500 rps and then down to 0 over 20
                                    // seconds:
                                    //      [[0, 100], [10, 500], [20, 0]]
};

/** Loop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is scheduled
in the node.js event loop using process.nextTick(), which allows other events in the loop to be handled
as the loop executes. Loop emits the events 'start' (before the first iteration), 'end', 'startiteration'
and 'enditeration'.

@param funOrSpec    Either a loop specification object or a loop function. LOOP_OPTIONS lists all the 
                    supported fields in a loop specification.

                    A loop function is an asynchronous function that calls finished(result) when it
                    finishes:
                    
                        function(finished, args) {
                            ...
                            finished(result);
                        }
                    
                    use the static method Loop.funLoop(f) to wrap simple, non-asynchronous functions.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. Loop#timeLimit and Loop#maxExecutions 
                    are conditions that can be used here. 
@param rps          max number of times per second this loop should execute */
var Loop = exports.Loop = function Loop(funOrSpec, args, conditions, rps) {
    EventEmitter.call(this);
    
    if (typeof funOrSpec === 'object') {
        var spec = util.defaults(funOrSpec, LOOP_OPTIONS);

        funOrSpec = spec.fun;
        args = spec.argGenerator ? spec.argGenerator() : spec.args;
        conditions = [];
        rps = spec.rps;

        if (spec.numberOfTimes > 0 && spec.numberOfTimes < Infinity) {
            conditions.push(Loop.maxExecutions(spec.numberOfTimes));
        }
        if (spec.duration > 0 && spec.duration < Infinity) {
            conditions.push(Loop.timeLimit(spec.duration));
        }
    }

    this.__defineGetter__('rps', function() { return rps; });
    this.__defineSetter__('rps', function(val) {
        rps = (val >= 0) ? val : Infinity;
        this.timeout_ = Math.floor(1/rps * 1000);
        if (this.restart_ && this.timeout_ < Infinity) {
            var oldRestart = this.restart_;
            this.restart_ = null;
            oldRestart();
        }
    });
    
    this.id = util.uid();
    this.fun = funOrSpec;
    this.args = args;
    this.conditions = conditions || [];
    this.running = false;
    this.rps = rps;
};

util.inherits(Loop, EventEmitter);

/** Start executing this.fun with the arguments, this.args, until any condition in this.conditions
returns false. When the loop completes the 'end' event is emitted. */
Loop.prototype.start = function() {
    var self = this,
        startLoop = function() {
            self.emit('start');
            self.loop_();
        };

    if (self.running) { return; }
    self.running = true;
    process.nextTick(startLoop);
    return this;
};

Loop.prototype.stop = function() {
    this.running = false;
};

/** Calls each function in Loop.conditions. Returns false if any function returns false */
Loop.prototype.checkConditions_ = function() {
    var self = this;
    return this.running && this.conditions.every(function(c) { return c.bind(self)(); });
};

/** Checks conditions and schedules the next loop iteration. 'startiteration' is emitted before each
iteration and 'enditeration' is emitted after. */
Loop.prototype.loop_ = function() {
    
    var self = this, result, active, lagging,
        callfun = function() {
            if (self.timeout_ === Infinity) { 
                self.restart_ = callfun;
                return;
            }

            result = null; active = true; lagging = (self.timeout_ <= 0);
            if (!lagging) {
                setTimeout(function() { 
                    lagging = active;
                    if (!lagging) { self.loop_(); }
                }, self.timeout_);
            }
            self.emit('startiteration', self.args);
            var start = new Date();
            self.fun(function(res) { 
                    active = false;
                    result = res;
                    self.emit('enditeration', result);
                    if (lagging) { self.loop_(); }
                }, self.args);
        };

    if (self.checkConditions_()) {
        process.nextTick(callfun);
    } else {
        self.running = false;
        self.emit('end');
    }
};


// Predefined functions that can be used in Loop.conditions

/** Returns false after a given number of seconds */
Loop.timeLimit = function(seconds) {
    var start = new Date();
    return function() { 
        return (seconds === Infinity) || ((new Date() - start) < (seconds * 1000));
    };
};
/** Returns false after a given number of iterations */
Loop.maxExecutions = function(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes === Infinity) || (counter++ < numberOfTimes);
    };
};


// Helpers for dealing with loop functions

/** A wrapper for any existing function so it can be used by Loop. e.g.:
        myfun = function(x) { return x+1; }
        new Loop(Loop.funLoop(myfun), args, [Loop.timeLimit(10)], 0) */
Loop.funLoop = function(fun) {
    return function(finished, args) {
        finished(fun(args));
    };
};
/** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
calls finish(result-from-fun, startRes) when fun() finishes. */
Loop.loopWrapper = function(fun, start, finish) {
    return function(finished, args) {
        var startRes = start && start(args),
            finishFun = function(result) {
                if (result === undefined) {
                    util.qputs('Function result is null; did you forget to call finished(result)?');
                }

                if (finish) { finish(result, startRes); }
                
                finished(result);
            };
        fun(finishFun, args);
    };
};