#!/usr/bin/env node

var util = require('./lib/util');

var include = function(name) {
    util.extend(module.exports, require(name));
}

include('./lib/config');
include('./lib/loadtesting');
include('./lib/remote')
