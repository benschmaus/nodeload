var fs = require('fs'),
    _ = require('underscore'),
    temp = require('temp'),
    path = require('path');

var RequestContainer = module.exports = function() {

    this.reqDir = temp.mkdirSync('requests');
    
    this.nextIndex = 0;
};

RequestContainer.prototype.add = function(request) {
    fs.writeFileSync(path.join(this.reqDir, this.nextIndex + ".json"), JSON.stringify(request), 'utf8');
    this.nextIndex++;
};

RequestContainer.prototype.get = function(index) {
    if (index >= this.nextIndex)
        return null;

    return JSON.parse(fs.readFileSync(path.join(this.reqDir, index + ".json"), 'utf8'));
};

RequestContainer.prototype.length = function() {
    return this.nextIndex;
};