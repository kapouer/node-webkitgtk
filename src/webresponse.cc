#include "webresponse.h"
#include "soupheaders.h"

using namespace v8;

Persistent<FunctionTemplate> WebResponse::constructor;

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

void WebResponse::Init(Handle<Object> target) {
  NanScope();

  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(WebResponse::New);
  tpl->InstanceTemplate()->SetInternalFieldCount(1);
  tpl->SetClassName(NanNew("WebResponse"));

  ATTR(tpl, "uri", get_prop, NULL);
  ATTR(tpl, "status", get_prop, NULL);
  ATTR(tpl, "mime", get_prop, NULL);
  ATTR(tpl, "headers", get_prop, NULL);
  ATTR(tpl, "length", get_prop, NULL);
  ATTR(tpl, "filename", get_prop, NULL);

  NODE_SET_PROTOTYPE_METHOD(tpl, "data", WebResponse::Data);

  target->Set(NanNew("WebResponse"), tpl->GetFunction());
  NanAssignPersistent(constructor, tpl);
}

NAN_METHOD(WebResponse::New) {
  NanScope();
  WebResponse* self = new WebResponse();
  self->Wrap(args.This());
  NanReturnValue(args.This());
}

NAN_METHOD(WebResponse::Data) {
  NanScope();
  WebResponse* self = ObjectWrap::Unwrap<WebResponse>(args.This());
  if (self->resource == NULL) {
    NanThrowError("cannot call data(cb) on a response decision");
    NanReturnUndefined();
  }
  self->dataCallback = new NanCallback(args[0].As<Function>());

  webkit_web_resource_get_data(self->resource, NULL, WebResponse::DataFinished, self);
  NanReturnUndefined();
}

void WebResponse::DataFinished(GObject* object, GAsyncResult* result, gpointer data) {
  WebResponse* self = (WebResponse*)data;
  GError* error = NULL;
  gsize length;
  guchar* buf = webkit_web_resource_get_data_finish(self->resource, result, &length, &error);
  if (buf == NULL) { // if NULL, error is defined
    Handle<Value> argv[] = {
      NanError(error != NULL ? error->message : "Empty buffer")
    };
    self->dataCallback->Call(1, argv);
    delete self->dataCallback;
    if (error != NULL) g_error_free(error);
    self->dataCallback = NULL;
    return;
  }
  Handle<Value> argv[] = {
    NanNull(),
    NanNewBufferHandle(reinterpret_cast<const char*>(buf), length)
  };
  self->dataCallback->Call(2, argv);
}

NAN_GETTER(WebResponse::get_prop) {
  NanScope();
  WebResponse* self = node::ObjectWrap::Unwrap<WebResponse>(args.Holder());

  std::string propstr = TOSTR(property);

  if (propstr == "uri") {
    NanReturnValue(NanNew<String>(webkit_web_resource_get_uri(self->resource)));
  } else if (propstr == "mime" && self->response != NULL) {
    NanReturnValue(NanNew<String>(webkit_uri_response_get_mime_type(self->response)));
  } else if (propstr == "status") {
    if (self->response != NULL) {
      NanReturnValue(NanNew<Integer>(webkit_uri_response_get_status_code(self->response)));
    } else {
      NanReturnValue(NanNew<Integer>(0));
    }
  } else if (propstr == "headers") {
    Handle<Object> obj = SoupHeaders::constructor->GetFunction()->NewInstance();
    SoupHeaders* selfHeaders = node::ObjectWrap::Unwrap<SoupHeaders>(obj);
    selfHeaders->init(webkit_uri_response_get_http_headers(self->response));
    NanReturnValue(obj);
  } else if (propstr == "length") {
    if (self->response != NULL) {
      NanReturnValue(NanNew<Integer>(webkit_uri_response_get_content_length(self->response)));
    } else {
      NanReturnValue(NanNew<Integer>(0));
    }
  } else if (propstr == "filename") {
    if (self->response == NULL) NanReturnNull();
    const char* filename = webkit_uri_response_get_suggested_filename(self->response);
    if (filename == NULL) NanReturnNull();
    else NanReturnValue(NanNew<String>(filename));
  }
  NanReturnUndefined();
}

// NAN_SETTER(WebResponse::set_prop) {
  // NanScope();
  // WebResponse* self = node::ObjectWrap::Unwrap<WebResponse>(args.Holder());
  // std::string propstr = TOSTR(property);
  // if (propstr == "cancel") {
    // self->cancel = value->BooleanValue();
  // }
  // NanThrowError("Cannot a property on response object");
// }