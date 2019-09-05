#include "webrequest.h"
#include "gvariantproxy.h"

using namespace v8;

Nan::Persistent<FunctionTemplate> WebRequest::constructor;

WebRequest::WebRequest() {}

WebRequest::~WebRequest() {
	g_object_unref(request);
}

void WebRequest::init(WebKitURIRequest* request) {
	this->request = request;
	g_object_ref(request);
}

void WebRequest::Init(Local<Object> target) {
	Nan::HandleScope scope;

	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(WebRequest::New);
	tpl->InstanceTemplate()->SetInternalFieldCount(1);
	tpl->SetClassName(Nan::New("WebRequest").ToLocalChecked());

	ATTR(tpl, "uri", get_prop, NULL);
	ATTR(tpl, "headers", get_prop, NULL);

	target->Set(Nan::New("WebRequest").ToLocalChecked(), tpl->GetFunction());
	constructor.Reset(tpl);
}

NAN_METHOD(WebRequest::New) {
	Nan::HandleScope scope;
	WebRequest* self = new WebRequest();
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}

NAN_GETTER(WebRequest::get_prop) {
	Nan::HandleScope scope;
	WebRequest* self = node::ObjectWrap::Unwrap<WebRequest>(info.Holder());

	std::string propstr = TOSTR(property);

	if (propstr == "uri") {
		info.GetReturnValue().Set(Nan::New<String>(webkit_uri_request_get_uri(self->request)).ToLocalChecked());
	} else if (propstr == "headers") {
		Local<Object> obj = Nan::NewInstance(Nan::GetFunction(Nan::New(GVariantProxy::constructor)).ToLocalChecked()).ToLocalChecked();
		GVariantProxy* prox = node::ObjectWrap::Unwrap<GVariantProxy>(obj);
		prox->init(soup_headers_to_gvariant_dict(webkit_uri_request_get_http_headers(self->request)));
		info.GetReturnValue().Set(obj);
	}
}

