var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("wait for event", function suite() {
	it("load then call png", function(done) {
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
	it("idle then call png", function(done) {
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
	it("ready then load then idle then unload", function(done) {
		this.timeout(5000);
		var calls = 0;
		function called(num, ev) {
			expect(calls).to.be(num);
			calls++;
			if (calls == 3) done();
		}
		WebKit().load("https://www.debian.org/")
			.wait('ready', called.bind(null, 0, "ready"))
			.wait('load', called.bind(null, 1, "load"))
			.wait('idle', called.bind(null, 2, "idle"));
	});
});


