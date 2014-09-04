var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("changing request uri in listener", function suite() {
	it("should cancel the request when set to null or empty string", function(done) {
		this.timeout(10000);
		var cancelledRequests = 0;
		WebKit("http://www.selmer.fr").on("request", function(request, view) {
			if (/\.js$/.test(request.uri)) {
				cancelledRequests++;
				request.uri = null;
			}
		}).on("response", function(response) {
			expect(/\.js$/.test(response.uri)).to.not.be(true);
		}).on("load", function(view) {
			expect(cancelledRequests).to.be.greaterThan(3);
			done();
		});
	});
});
