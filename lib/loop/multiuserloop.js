var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var userloop = require('./userloop');
var MultiLoop = require('./multiloop').MultiLoop;
var EventEmitter = require('events').EventEmitter;
var UserLoop = userloop.UserLoop;
var USER_LOOP_OPTIONS = UserLoop.USER_LOOP_OPTIONS;
}

var MultiUserLoop = exports.MultiUserLoop = function MultiUserLoop(spec) {
    EventEmitter.call(this);
    this.spec = util.extend({}, util.defaults(spec, USER_LOOP_OPTIONS));
    this.loops = [];
    this.concurrencyProfile = spec.concurrencyProfile || [[0, spec.concurrency]];
    this.updater_ = this.update_.bind(this);
    this.finishedChecker_ = this.checkFinished_.bind(this);
}
util.inherits(MultiUserLoop, MultiLoop);

/** Start all scheduled Loops. When the loops complete, 'end' event is emitted. */
MultiUserLoop.prototype.start = function() {
    if (this.running) { return; }
    this.running = true;
    this.startTime = new Date();
    this.concurrency = 0;
    this.loops = [];
    this.loopConditions_ = [];

    if (this.spec.numberOfTimes > 0 && this.spec.numberOfTimes < Infinity) {
        this.loopConditions_.push(Loop.maxExecutions(this.spec.numberOfTimes));
    }

    if (this.spec.duration > 0 && this.spec.duration < Infinity) {
        this.endTimeoutId = setTimeout(this.stop.bind(this), this.spec.duration * 1000);
    }

    process.nextTick(this.emit.bind(this, 'start'));
    this.update_();
    return this;
};

/** Force all loops to finish */
MultiUserLoop.prototype.stop = function() {
    if (!this.running) { return; }
    clearTimeout(this.endTimeoutId);
    clearTimeout(this.updateTimeoutId);
    this.running = false;
    this.loops.forEach(function(l) { l.stop(); });
    this.emit('remove', this.loops);
    this.emit('end');
    this.loops = [];
};


MultiUserLoop.prototype.update_ = function() {
    var i, now = Math.floor((new Date() - this.startTime) / 1000),
        concurrency = this.getProfileValue_(this.concurrencyProfile, now),
        timeout = this.getProfileTimeToNextValue_(this.concurrencyProfile, now) * 1000;

    if (concurrency < this.concurrency) {
        var removed = this.loops.splice(concurrency);
        removed.forEach(function(l) { l.stop(); });
        this.emit('remove', removed);
    } else if (concurrency > this.concurrency) {
        var loops = [];
        for (i = 0; i < concurrency-this.concurrency; i++) {
            var loop = new UserLoop(this.spec.userProgram, this.spec.programArguments, this.loopConditions_).start();
            loop.on('end', this.finishedChecker_);
            loops.push(loop);
        }
        this.loops = this.loops.concat(loops);
        this.emit('add', loops);
    }

    this.concurrency = concurrency;

    if (timeout < Infinity) {
        this.updateTimeoutId = setTimeout(this.updater_, timeout);
    }
};
