var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');
describe("preload method", function suite() {
	it("should not run scripts", function(done) {
		var doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script>\<script type="text/javascript" src="test.js"></script>\
		<script src="test.js"></script></head>\
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
		}).listen(8022);
		WebKit().preload("http://localhost:8022", {console:true}).wait('load').html(function(err, str) {
			expect(str).to.be(doc);
			setTimeout(function() {
				server.close();
				done();
			}, 100);
		});
	});
	it("should preload then load and wait idle", function(done) {
		var doc = '<html><head><script>\
		document.writeln("<meta name=\'test\'></meta>");\
		</script><script type="text/javascript" src="test.js"></script>\
		<script src="test.js"></script></head>\
		<body onload="document.body.appendChild(document.createTextNode(\'toto\'))">\
		<script type="text/javascript">document.writeln("<p>there</p>");</script>\
		</body></html>';
		var script = '<script type="text/javascript" src="test2.js"></script>';

		var server = require('http').createServer(function(req, res) {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test.js") {
				res.statusCode = 200;
				res.setHeader('Content-Type', "application/javascript");
				res.write('document.documentElement.setAttribute("test", "toto");');
				res.end();
			} else if (req.url == "/test2.js") {
				// never called !
				expect(false).to.be(true);
				res.statusCode = 200;
				res.setHeader('Content-Type', "application/javascript");
				res.write('document.documentElement.setAttribute("test", "tota");');
				res.end();
			} else {
				res.statusCode = 404;
				res.end();
			}
		}).listen(8021);
		WebKit().preload("http://localhost:8021", {console: true}).wait('ready').html(function(err, str) {
			expect(str).to.be(doc);
			this.run(function(script, done) {
				var script = document.createElement('script');
				script.type = 'text/javascript';
				script.src = 'test2.js';
				document.head.appendChild(script);
				done();
			}, script).html(function(err, str) {
				expect(err).to.not.be.ok();
				var strc = str;
				expect(str.replace(script, '')).to.be(doc);
				expect(strc.indexOf(script) > 0).to.be(true);
			});
			this.load("http://localhost:8021", {content: doc}).wait('idle').html(function(err, str) {
				if (err) console.error(err);
				var wroteMeta = '<meta name="test">\n';
				var wroteP = '<p>there</p>\n';
				expect(str.indexOf(wroteMeta)).to.be.ok();
				expect(str.indexOf(wroteP)).to.be.ok();
				setTimeout(function() {
					server.close();
					done();
				}, 100);
			});
		});
	});
});
