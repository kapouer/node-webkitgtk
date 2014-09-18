var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("uri property", function suite() {
	it("should be undefined before initialization and before load", function() {
		var view = new WebKit();
		expect(view.uri).to.be(undefined);
	});
	it("should be undefined after initialization and before load", function(done) {
		var view = new WebKit({display:0}, function(err) {
			console.log("done initializating");
			expect(view.uri).to.be(undefined);
			done();
		});
	});
	it("should add a trailing slash - not that it matters but it's a sign it works", function(done) {
		var view = new WebKit();
		var uri = 'http://localhost';
		view.load(uri, function(err) {
			expect(view.uri).to.be(uri + '/');
			done();
		});
	});
});
