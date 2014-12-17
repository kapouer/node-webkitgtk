var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("changing request uri in listener", function suite() {
	it("should cancel the request when set to null or empty string", function(done) {
		this.timeout(15000);
		var cancelledRequests = 0;
		WebKit().load("http://www.selmer.fr").on("request", function(request) {
			if (/\.js$/.test(request.uri)) {
				cancelledRequests++;
				request.uri = null;
			}
		}).on("response", function(response) {
			expect(/\.js$/.test(response.uri)).to.not.be(true);
		}).on("load", function() {
			expect(cancelledRequests).to.be.greaterThan(3);
			done();
		}).on("error", function() {
			// just ignore errors here
		});
	});
});
