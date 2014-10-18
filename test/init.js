var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("init method", function suite() {
	it("should initialize cacheDir", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit({cacheDir: "cache"}, function(err) {
			expect(err).to.not.be.ok();
			called = true;
		}).load('http://google.com', function(err) {
			fs.exists("./cache", function(yes) {
				expect(yes).to.be.ok();
				done();
			});
		});
	});
});

