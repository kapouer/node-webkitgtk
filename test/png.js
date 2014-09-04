var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("png method", function suite() {
	it("should save a screenshot to disk", function(done) {
		this.timeout(10000);
		WebKit("http://www.neufdeuxtroisa.fr", {
			width:400, height:1000,
			stylesheet: __dirname + "/../css/png.css"
		}, function(err) {
			expect(err).to.not.be.ok();
		}).on("load", function(view) {
			var filepath = __dirname + '/shots/test.png';
			view.png().save(filepath, function(err) {
				expect(err).to.not.be.ok();
				fs.stat(filepath, function(err, stat) {
					expect(stat.size).to.be.above(100000);
					done();
				});
			});
		});
	});
});


