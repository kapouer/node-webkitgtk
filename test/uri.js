var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("uri property", function suite() {
	it("should be undefined before initialization and before load", function() {
		var view = new WebKit();
		expect(view.uri).to.be(undefined);
	});
	it("should be undefined after initialization and before load", function(done) {
		WebKit(function(err, w) {
			expect(w.uri).to.be(undefined);
			done();
		});
	});
	it("should add a trailing slash - not that it matters but it's a sign it works", function(done) {
		var uri = 'http://localhost';
		WebKit.load(uri, function(err, w) {
			expect(w.uri).to.be(uri + '/');
			done();
		});
	});
});
