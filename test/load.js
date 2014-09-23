var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("load method", function suite() {
	it("should initialize display if it was not on instantiation", function(done) {
		this.timeout(10000);
		var called = false;
		WebKit(0, function(err) {
			expect(err).to.not.be.ok();
			called = true;
		}).load('http://google.com', function(err) {
			expect(this.status).to.be(200);
			expect(err).to.not.be.ok();
			expect(called).to.be.ok();
			done();
		});
	});

	it("should callback with error when url cannot be resolved", function(done) {
		this.timeout(10000);
		WebKit().load("http://atipepipapa-sdqdqsd.com", function(err) {
			expect(err).to.be.ok();
			done();
		});
	});

	it("should 404", function(done) {
		this.timeout(1000);
		WebKit().load("http://google.com/sdfsdfsdf", function(err) {
			expect(err).to.be(404);
			done();
		});
	});

	it("should allow to load another uri just after", function(done) {
		this.timeout(5000);
		WebKit().load('http://google.com').load('http://geoip.edagames.com', function() {
			this.once('response', function(res) {
				res.data(function(err, data) {
					expect(JSON.parse(data.toString()).country).to.be.ok();
					done();
				});
			});
		});
	});
});
