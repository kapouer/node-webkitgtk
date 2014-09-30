var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("wait for", function suite() {
	it("load should do the same for png", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/testwait.png';
		WebKit().load("https://www.debian.org/").wait("load").png(filepath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(filepath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				done();
			});
		});
	});
	it("idle should work too", function(done) {
		this.timeout(10000);
		var filepath = __dirname + '/shots/test3.png';
		WebKit().load("https://www.debian.org/").wait("idle").png(filepath, function(err) {
			expect(err).to.not.be.ok();
			fs.stat(filepath, function(err, stat) {
				expect(stat.size).to.be.above(50000);
				done();
			});
		});
	});
});


