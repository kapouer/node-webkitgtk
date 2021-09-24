class Response {
	constructor(view, binding) {
		this.binding = binding;
		this.view = view;
	}
	data(cb) {
		if (!cb) throw new Error("Missing callback");
		this.binding.data(cb);
		return this;
	}
}

module.exports = Response;

function defineCachedGet(proto, prop, name) {
	const hname = '_' + name;
	Object.defineProperty(proto, name, {
		get: function() {
			if (this[hname] == undefined) this[hname] = this[prop][name];
			return this[hname];
		}
	});
}

for (const name of ["uri", "status", "mime", "headers", "length", "filename", "stall"]) {
	defineCachedGet(Response.prototype, "binding", name);
}

