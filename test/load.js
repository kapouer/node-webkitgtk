var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("load method", function suite() {
	it("should initialize display if it was not on instantiation", function(done) {
		var called = false;
		var view = new WebKit({display: 0}, function(err) {
			expect(err).to.not.be.ok();
			called = true;
		});
		view.load('http://google.com', function(err) {
			expect(err).to.not.be.ok();
			expect(called).to.be.ok();
			done();
		});
	});
});

describe("load method", function suite() {
	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit("http://atipepipapa-sdqdqsd.com", function(err, html) {
			expect(err).to.be.ok();
			done();
		});
	});
});
