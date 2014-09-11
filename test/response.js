var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("response handler data method", function suite() {
	it("should get data from the response", function(done) {
		this.timeout(5000);
		WebKit("https://www.debian.org/logos/openlogo-nd-100.png").on("response", function(response) {
			if (response.uri == this.uri) {
				response.data(function(err, data) {
					expect(data.slice(1, 4).toString()).to.be("PNG");
					expect(data.length).to.be.greaterThan(1000);
					done();
				});
			}
		});
	});
});


