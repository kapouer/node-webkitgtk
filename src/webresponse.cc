#include "webresponse.h"
#include "gvariantproxy.h"

using namespace v8;

Nan::Persistent<FunctionTemplate> WebResponse::constructor;

WebResponse::WebResponse() {}

WebResponse::~WebResponse() {
	if (response != NULL) g_object_unref(response);
	g_object_unref(resource);
	delete dataCallback;
}

void WebResponse::init(WebKitWebResource* resource, WebKitURIResponse* response) {
	this->resource = resource;
	g_object_ref(resource);
	this->response = response;
	// response can be empty
	if (response != NULL) g_object_ref(response);
}

void WebResponse::Init(Local<Object> target) {
	Nan::HandleScope scope;

	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(WebResponse::New);
	tpl->InstanceTemplate()->SetInternalFieldCount(1);
	tpl->SetClassName(Nan::New("WebResponse").ToLocalChecked());

	ATTR(tpl, "uri", get_prop, NULL);
	ATTR(tpl, "status", get_prop, NULL);
	ATTR(tpl, "mime", get_prop, NULL);
	ATTR(tpl, "headers", get_prop, NULL);
	ATTR(tpl, "length", get_prop, NULL);
	ATTR(tpl, "filename", get_prop, NULL);

	Nan::SetPrototypeMethod(tpl, "data", WebResponse::Data);

	target->Set(Nan::New("WebResponse").ToLocalChecked(), tpl->GetFunction());
	constructor.Reset(tpl);
}

NAN_METHOD(WebResponse::New) {
	Nan::HandleScope scope;
	WebResponse* self = new WebResponse();
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}

NAN_METHOD(WebResponse::Data) {
	Nan::HandleScope scope;
	WebResponse* self = ObjectWrap::Unwrap<WebResponse>(info.This());
	if (self->resource == NULL) {
		Nan::ThrowError("cannot call data(cb) on a response decision");
		return;
	}
	self->dataCallback = new Nan::Callback(info[0].As<Function>());

	webkit_web_resource_get_data(self->resource, NULL, WebResponse::DataFinished, self);
	return;
}

void WebResponse::DataFinished(GObject* object, GAsyncResult* result, gpointer data) {
	WebResponse* self = (WebResponse*)data;
	GError* error = NULL;
	gsize length;
	guchar* buf = webkit_web_resource_get_data_finish(self->resource, result, &length, &error);
	Nan::HandleScope scope;
	if (buf == NULL) { // if NULL, error is defined
		Local<Value> argv[] = {
			Nan::Error(error != NULL ? error->message : "Empty buffer")
		};
		Nan::Call(*(self->dataCallback), 1, argv);
		delete self->dataCallback;
		if (error != NULL) g_error_free(error);
		self->dataCallback = NULL;
		return;
	}
	Local<Value> argv[] = {
		Nan::Null(),
		Nan::NewBuffer(reinterpret_cast<char*>(buf), length).ToLocalChecked()
	};
	Nan::Call(*(self->dataCallback), 2, argv);
}

NAN_GETTER(WebResponse::get_prop) {
	Nan::HandleScope scope;
	WebResponse* self = node::ObjectWrap::Unwrap<WebResponse>(info.Holder());

	std::string propstr = TOSTR(property);

	if (propstr == "uri") {
		info.GetReturnValue().Set(Nan::New<String>(webkit_web_resource_get_uri(self->resource)).ToLocalChecked());
	} else if (propstr == "mime" && self->response != NULL) {
		info.GetReturnValue().Set(Nan::New<String>(webkit_uri_response_get_mime_type(self->response)).ToLocalChecked());
	} else if (propstr == "status") {
		guint status = 0;
		if (self->response != NULL) {
			status = webkit_uri_response_get_status_code(self->response);
			if (status == 0 && webkit_uri_response_get_content_length(self->response) > 0) status = 200;
		}
		info.GetReturnValue().Set(Nan::New<Integer>(status));
	} else if (propstr == "headers") {
		if (self->response == NULL) {
			info.GetReturnValue().Set(Nan::Null());
		} else {
			Local<Object> obj = Nan::NewInstance(Nan::GetFunction(Nan::New(GVariantProxy::constructor)).ToLocalChecked()).ToLocalChecked();
			GVariantProxy* prox = node::ObjectWrap::Unwrap<GVariantProxy>(obj);
			prox->init(soup_headers_to_gvariant_dict(webkit_uri_response_get_http_headers(self->response)));
			info.GetReturnValue().Set(obj);
		}
	} else if (propstr == "length") {
		if (self->response != NULL) {
			info.GetReturnValue().Set(Nan::New<Integer>((int)webkit_uri_response_get_content_length(self->response)));
		} else {
			info.GetReturnValue().Set(Nan::New<Integer>(0));
		}
	} else if (propstr == "filename") {
		if (self->response == NULL) {
			info.GetReturnValue().Set(Nan::Null());
		} else {
			const char* filename = webkit_uri_response_get_suggested_filename(self->response);
			if (filename == NULL) info.GetReturnValue().Set(Nan::Null());
			else info.GetReturnValue().Set(Nan::New<String>(filename).ToLocalChecked());
		}
	}
}

// NAN_SETTER(WebResponse::set_prop) {
	// Nan::HandleScope scope;
	// WebResponse* self = node::ObjectWrap::Unwrap<WebResponse>(info.Holder());
	// std::string propstr = TOSTR(property);
	// if (propstr == "cancel") {
		// self->cancel = value->BooleanValue();
	// }
	// Nan::ThrowError("Cannot a property on response object");
// }
