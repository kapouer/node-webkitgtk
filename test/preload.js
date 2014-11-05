var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
describe("preload method", function suite() {
	it("should not run scripts", function(done) {
		var doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script>\<script type="text/javascript" src="test.js"></script></head>\
		<body onload="document.body.appendChild(document.createTextNode(\'toto\'))">\
		<script type="text/javascript">document.writeln("<p>there</p>");</script>\
		</body></html>'
		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js") {
				res.statusCode = 200;
				res.end('document.documentElement.className="toto";');
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(8021);
		WebKit().preload("http://localhost:8021").wait('ready').html(function(err, str) {
			expect(str).to.be(doc);
			setTimeout(function() {
				server.close();
				done();
			}, 100);
		});
	});
});
