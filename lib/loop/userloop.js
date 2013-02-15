// -----------------------------------------
// UserLoop
// -----------------------------------------
//
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var Loop = require('./loop').Loop;
var Program = require('../user/program').Program;
var _ = require('underscore');

var USER_LOOP_OPTIONS = exports.USER_LOOP_OPTIONS = {
    program: undefined,
    duration: Infinity,
    numberOfTimes: Infinity,
    concurrency: 1,
    concurrencyProfile: undefined
};

var UserLoop = exports.UserLoop = function UserLoop(programOrSpec, args, conditions) {
    console.log('new user coming online');
    EventEmitter.call(this);

    if (_(programOrSpec).isString()) {
        programOrSpec = require(programOrSpec);
    }


    this.id = util.uid();
    this.programFn = programOrSpec;
    this.programArgs = args || {};
    this.restartProgram();
    this.conditions = conditions || [];
    this.running = false;
};

util.inherits(UserLoop, Loop);

/** Start executing this.fun until any condition in this.conditions
returns false. When the loop completes the 'end' event is emitted. */
UserLoop.prototype.start = function() {
    var self = this,
        startLoop = function() {
            self.emit('start');
            console.log("Starting main program: " + self.programFn.program.name);
            self.loop_(self.headProgram);
        };

    if (self.running) { return; }
    self.running = true;
    process.nextTick(startLoop);
    return this;
};

UserLoop.prototype.stop = function() {
    this.running = false;
};

UserLoop.prototype.wireInDependentPrograms = function(parentProgram, dependents) {
    var self = this;
    _(dependents).each(function(dependent) {
        parentProgram.on(dependent.onEvent, function(eventArgs) {
            console.log('Starting dependent program: ' + dependent.program.name);
            
            // Creates and starts the child program
            var startChild = function() {
                var child = new Program(dependent.program.program, _({}).extend(self.programArgs, eventArgs));
                if (dependent.dependents) {
                    self.wireInDependentPrograms(child, dependent.dependents);
                }

                self.loop_(child);
            };

            if (!dependent.cardinality)
                dependent.cardinality = 1;

            // Support only triggering dependent programs some of the time
            if (dependent.cardinality < 1) {
                if (Number.random() < dependent.cardinality) {
                    startChild();
                }
            } else {
                _(dependent.cardinality).times(function() {
                    startChild();
                });
            }

        });
    });
};

UserLoop.prototype.restartProgram = function() {
    if (_(this.programFn).isFunction()) {
        this.headProgram = new Program(this.programFn, this.programArgs);
    } else {
        this.headProgram = new Program(this.programFn.program.program, this.programArgs);
        this.wireInDependentPrograms(this.headProgram, this.programFn.dependents);
    }

};

/** Checks conditions and schedules the next loop iteration. 'startiteration' is emitted before each
iteration and 'enditeration' is emitted after. */
UserLoop.prototype.loop_ = function(program) {
    var self = this, result, active,
        callfun = function() {
            result = null; active = true;
            if (program.finished()) {
                // TODO: How's this gonna work with dependent programs?
                // self.restartProgram();
                return;
            }

            var isRequest = program.pendingIsRequest();
            if (isRequest) {
                self.emit('startiteration');
            }
            program.next(function(res) {
                if (isRequest) {
                    self.emit('enditeration', res);
                }
                self.loop_(program);
            });
        };

    if (self.checkConditions_()) {
        process.nextTick(callfun);
    } else {
        self.running = false;
        self.emit('end');
    }
};
