var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

// this test doesn't really work

describe("init method", function suite() {
	it("should initialize cacheDir with call to init", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit({cacheDir: "cache/test"}, function(err, w) {
			expect(err).to.not.be.ok();
			called = true;
			w.load('http://google.com', function(err) {
				fs.exists("./cache/test", function(yes) {
					expect(yes).to.be.ok();
					done();
				});
			});
		});
	});
});

