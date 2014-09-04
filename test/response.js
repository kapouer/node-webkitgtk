var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("response handler data method", function suite() {
	it("should get data from the response", function(done) {
		this.timeout(5000);
		WebKit("http://www.google.com").on("response", function(response, view) {
			if (response.uri == "https://www.google.fr/images/nav_logo195.png") {
				response.data(function(err, data) {
					expect(data.slice(1, 4).toString()).to.be("PNG");
					expect(data.length).to.be.greaterThan(15000);
					done();
				});
			}
		});
	});
});


