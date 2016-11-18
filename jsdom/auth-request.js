module.exports = AuthRequest;

function AuthRequest(req, res) {
	this.req = req;
	this.host = req.uri.hostname;
	this.port = parseInt(req.uri.port);
	var header = res.headers['www-authenticate'];
	if (header) {
		var realMatch = /realm="(\w+)"/.exec(header);
	}
	this.realm = realMatch && realMatch[1] || null;
}

AuthRequest.prototype.use = function(user, pass, realm) {
	this.req.auth(user, pass, false, realm);
};

AuthRequest.prototype.ignore = function() {
	// this is the default behavior anyway
};

