#include <JavaScriptCore/JSValueRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include <node.h>
#include "utils.h"
#include "webview.h"
#include "gvariantproxy.h"
#include "webresponse.h"
#include "webrequest.h"
#include "webauthrequest.h"


using namespace v8;

Nan::Persistent<Function> WebView::constructor;

static uv_timer_t* timeout_handle = new uv_timer_t;

#if UV_VERSION_MAJOR >= 1
void timeout_cb(uv_timer_t* handle) {
#else
void timeout_cb(uv_timer_t* handle, int status) {
#endif
	if (gtk_events_pending()) {
		gtk_main_iteration_do(false);
	}
}

WebView::WebView(Local<Object> opts) {
	Nan::Utf8String* cstampStr = getOptStr(opts, "cstamp");
	this->cstamp = **cstampStr;
	this->receiveDataCallback = getCb(opts, "receiveDataListener");
	this->responseCallback = getCb(opts, "responseListener");
	this->eventsCallback = getCb(opts, "eventsListener");
	this->policyCallback = getCb(opts, "policyListener");
	this->authCallback = getCb(opts, "authListener");
	this->closeCallback = getCb(opts, "closedListener");

	this->offscreen = opts->Get(H("offscreen"))->BooleanValue();
	this->resizing = opts->Get(H("resizing"))->BooleanValue();
	bool hasInspector = opts->Get(H("inspector"))->BooleanValue();

	Nan::AdjustExternalMemory(400000);

	state = 0;
	idGeometryChangedHandler = 0;
	idResourceResponse = 0;
	idEventsHandler = 0;

	if (instances.size() == 0) {
		uv_timer_start(timeout_handle, timeout_cb, 0, 5);
	}
	instances.insert(ObjMapPair(this->cstamp, this));

	Nan::Utf8String* cacheDirStr = getOptStr(opts, "cacheDir");
	if (cacheDirStr->length() == 0) {
		cacheDir = g_build_filename(g_get_user_cache_dir(), "node-webkitgtk", NULL);
	} else {
		cacheDir = g_strdup(**cacheDirStr);
	}
	delete cacheDirStr;
	#if WEBKIT_CHECK_VERSION(2,10,0)
	WebKitWebsiteDataManager* dataManager = webkit_website_data_manager_new(
		"base-cache-directory", cacheDir,
		NULL
	);
	context = webkit_web_context_new_with_website_data_manager(dataManager);
	g_object_unref(dataManager);
	#else
		#if WEBKIT_CHECK_VERSION(2,8,0)
	context = webkit_web_context_new();
		#else
	context = webkit_web_context_get_default();
		#endif
	webkit_web_context_set_disk_cache_directory(context, cacheDir);
	#endif

	Nan::Utf8String* cacheModelStr = getOptStr(opts, "cacheModel");
	WebKitCacheModel cacheModel = WEBKIT_CACHE_MODEL_WEB_BROWSER;
	if (cacheModelStr->length() != 0) {
		if (g_strcmp0(**cacheModelStr, "none") == 0) {
			cacheModel = WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER;
		} else if (g_strcmp0(**cacheModelStr, "browser") == 0) {
			cacheModel = WEBKIT_CACHE_MODEL_WEB_BROWSER;
		} else if (g_strcmp0(**cacheModelStr, "local") == 0) {
			cacheModel = WEBKIT_CACHE_MODEL_DOCUMENT_BROWSER;
		}
	}

	webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
	webkit_web_context_set_cache_model(context, cacheModel);
	webkit_web_context_set_tls_errors_policy(context, WEBKIT_TLS_ERRORS_POLICY_IGNORE);

	Nan::Utf8String* cookiePolicyStr = getOptStr(opts, "cookiePolicy");
	WebKitCookieManager* cookieManager = webkit_web_context_get_cookie_manager(context);
	if (!g_strcmp0(**cookiePolicyStr, "never")) {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_NEVER);
	} else if (!g_strcmp0(**cookiePolicyStr, "always")) {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_ALWAYS);
	} else {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_NO_THIRD_PARTY);
	}
	delete cookiePolicyStr;

	Nan::Utf8String* wePathStr = getOptStr(opts, "webextension");
	if (wePathStr->length() > 0) {
		extensionsDirectory = g_strdup(**wePathStr);
		this->contextSignalId = g_signal_connect(
			context,
			"initialize-web-extensions",
			G_CALLBACK(WebView::InitExtensions),
			this
		);
	}
	delete wePathStr;

	view = WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW,
		"user-content-manager", webkit_user_content_manager_new(),
		"web-context", context,
		NULL
	));

	WebKitSettings* settings = webkit_web_view_get_settings(view);

	if (!this->offscreen) {
		window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	} else {
		#if WEBKIT_CHECK_VERSION(2,16,0)
		g_object_set(G_OBJECT(settings), "hardware-acceleration-policy", WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER, NULL);
		#endif
		window = gtk_offscreen_window_new();
	}

	// WindowClosed will in turn call destroy (through webkitgtk.js closedListener)
	g_signal_connect(window, "destroy", G_CALLBACK(WebView::WindowClosed), this);
	#if WEBKIT_CHECK_VERSION(2,20,0)
	g_signal_connect(view, "web-process-terminated", G_CALLBACK(WebView::ViewCrashed), this);
	#else
	g_signal_connect(view, "web-process-crashed", G_CALLBACK(WebView::ViewCrashed), this);
	#endif

	GdkScreen* screen = gtk_window_get_screen(GTK_WINDOW(window));
	GdkVisual* rgba_visual = gdk_screen_get_rgba_visual(screen);
	if (rgba_visual) {
		gtk_widget_set_visual(window, rgba_visual);
#if WEBKIT_CHECK_VERSION(2,7,4)
		transparencySupport = TRUE;
#endif
	}
	gtk_widget_set_app_paintable(window, TRUE);

	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
	gtk_widget_show_all(window);

	if (hasInspector) {
		g_object_set(G_OBJECT(settings), "enable-developer-extras", TRUE, NULL);
		inspector = webkit_web_view_get_inspector(view);
		g_signal_connect(inspector, "closed", G_CALLBACK(WebView::InspectorClosed), this);
	} else {
		g_object_set(G_OBJECT(settings), "enable-developer-extras", FALSE, NULL);
	}

	g_signal_connect(view, "authenticate", G_CALLBACK(WebView::Authenticate), this);
	g_signal_connect(view, "load-failed", G_CALLBACK(WebView::Fail), this);
	g_signal_connect(view, "load-changed", G_CALLBACK(WebView::Change), this);
	g_signal_connect(view, "script-dialog", G_CALLBACK(WebView::ScriptDialog), this);
	g_signal_connect(view, "decide-policy", G_CALLBACK(WebView::DecidePolicy), this);

	WebKitWindowProperties* winprops = webkit_web_view_get_window_properties(view);
	idGeometryChangedHandler = g_signal_connect(winprops, "notify::geometry", G_CALLBACK(WebView::GeometryChanged), this);
}

NAN_METHOD(WebView::ClearCache) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	webkit_web_context_clear_cache(self->context);
}

NAN_METHOD(WebView::Stop) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	bool wasLoading = self->loadCallback != NULL;
	self->stopCallback = new Nan::Callback(info[0].As<Function>());
	webkit_web_view_stop_loading(self->view);
	// g_message("call to stop %d, %d", wasLoading, self->state);
	self->stop(wasLoading && self->state == DOCUMENT_COMMITED);
	info.GetReturnValue().Set(Nan::New<Boolean>(wasLoading));
}

NAN_METHOD(WebView::Destroy) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	self->destroy();
}

void WebView::destroy() {
	if (view == NULL) return;
	unloaded();
	if (idGeometryChangedHandler > 0) {
		g_signal_handler_disconnect(webkit_web_view_get_window_properties(view), idGeometryChangedHandler);
		idGeometryChangedHandler = 0;
	}
	if (context != NULL) {
		g_object_unref(context);
		context = NULL;
	}
	view = NULL;
	inspector = NULL;
	if (window != NULL) {
		gtk_widget_destroy(window);
		window = NULL;
	}

	if (uri != NULL) g_free(uri);
	if (cacheDir != NULL) g_free(cacheDir);
	if (extensionsDirectory != NULL) g_free(extensionsDirectory);

	if (pngCallback != NULL) delete pngCallback;
	if (pngFilename != NULL) delete pngFilename;

	if (printCallback != NULL) delete printCallback;
	if (printUri != NULL) delete printUri;

	if (loadCallback != NULL) delete loadCallback;
	if (stopCallback != NULL) delete stopCallback;
	if (receiveDataCallback != NULL) delete receiveDataCallback;
	if (responseCallback != NULL) delete responseCallback;
	if (policyCallback != NULL) delete policyCallback;
	if (eventsCallback != NULL) delete eventsCallback;
	if (authCallback != NULL) delete authCallback;
	if (closeCallback != NULL) delete closeCallback;
	instances.erase(cstamp);
	if (instances.size() == 0) {
		uv_timer_stop(timeout_handle);
	}
}

WebView::~WebView() {
	destroy();
}


void WebView::unloaded() {
	if (view == NULL) return;
	if (idResourceResponse > 0) {
		g_signal_handler_disconnect(view, idResourceResponse);
		idResourceResponse = 0;
	}
	WebKitUserContentManager* contman = webkit_web_view_get_user_content_manager(view);
	if (idEventsHandler > 0) {
		g_signal_handler_disconnect(contman, idEventsHandler);
		idEventsHandler = 0;
	}
	if (contman != NULL) {
		webkit_user_content_manager_remove_all_scripts(contman);
		webkit_user_content_manager_remove_all_style_sheets(contman);
		webkit_user_content_manager_unregister_script_message_handler(contman, "events");
	}
}

void WebView::Init(Local<Object> exports, Local<Object> module) {
	node::AtExit(Exit);

	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(WebView::New);
	tpl->SetClassName(Nan::New("WebView").ToLocalChecked());
	tpl->InstanceTemplate()->SetInternalFieldCount(1);

	Nan::SetPrototypeMethod(tpl, "load", WebView::Load);
	Nan::SetPrototypeMethod(tpl, "run", WebView::Run);
	Nan::SetPrototypeMethod(tpl, "runSync", WebView::RunSync);
	Nan::SetPrototypeMethod(tpl, "png", WebView::Png);
	Nan::SetPrototypeMethod(tpl, "pdf", WebView::Print);
	Nan::SetPrototypeMethod(tpl, "clearCache", WebView::ClearCache);
	Nan::SetPrototypeMethod(tpl, "stop", WebView::Stop);
	Nan::SetPrototypeMethod(tpl, "destroy", WebView::Destroy);
	Nan::SetPrototypeMethod(tpl, "inspect", WebView::Inspect);

	ATTR(tpl, "uri", get_prop, NULL);

	constructor.Reset(tpl->GetFunction());

	module->Set(Nan::New("exports").ToLocalChecked(), tpl->GetFunction());
	GVariantProxy::Init(exports);
	WebResponse::Init(exports);
	WebRequest::Init(exports);
	WebAuthRequest::Init(exports);

	gtk_init(0, NULL);
	uv_timer_init(uv_default_loop(), timeout_handle);
}

void WebView::InspectorClosed(WebKitWebInspector* inspector, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::HandleScope scope;
	Local<Value> argv[] = { Nan::New<String>("inspector").ToLocalChecked() };
	Nan::Call(*(self->closeCallback), 1, argv);
}

void WebView::WindowClosed(GtkWidget* window, gpointer data) {
	// wait until window has finished closing
	while (gtk_events_pending()) {
		gtk_main_iteration_do(true);
	}
	WebView* self = (WebView*)data;
	self->window = NULL;
	Nan::HandleScope scope;
	Local<Value> argv[] = { Nan::New<String>("window").ToLocalChecked() };
	Nan::Call(*(self->closeCallback), 1, argv);
}
#if WEBKIT_CHECK_VERSION(2,20,0)
void WebView::ViewCrashed(WebKitWebView* view, WebKitWebProcessTerminationReason reason, gpointer data) {
	WebView* self = (WebView*)data;
	self->window = NULL;
	Nan::HandleScope scope;
	Local<Value> argv[] = { Nan::New<String>("crash").ToLocalChecked() };
	Nan::Call(*(self->closeCallback), 1, argv);
}
#else
void WebView::ViewCrashed(WebKitWebView* view, gpointer data) {
	WebView* self = (WebView*)data;
	self->window = NULL;
	Nan::HandleScope scope;
	Local<Value> argv[] = { Nan::New<String>("crash").ToLocalChecked() };
	Nan::Call(*(self->closeCallback), 1, argv);
}
#endif

gboolean WebView::Authenticate(WebKitWebView* view, WebKitAuthenticationRequest* request, gpointer data) {
	WebView* self = (WebView*)data;
	if (webkit_authentication_request_is_retry(request)) return TRUE;

	// WebKitCredential* savedCred = webkit_authentication_request_get_proposed_credential(request);
	// if (savedCred != NULL) {
		// g_log("saved cred %s\n", webkit_credential_get_username(savedCred));
		// webkit_authentication_request_authenticate(request, savedCred);
		// return TRUE;
	// }
	Nan::HandleScope scope;
	Local<Object> obj = Nan::NewInstance(Nan::GetFunction(Nan::New(WebAuthRequest::constructor)).ToLocalChecked()).ToLocalChecked();
	WebAuthRequest* selfAuthRequest = node::ObjectWrap::Unwrap<WebAuthRequest>(obj);
	selfAuthRequest->init(request);

	Local<Value> argv[] = { obj };
	Local<Value> ignore = Nan::Call(*(self->authCallback), 1, argv).ToLocalChecked();
	if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
		webkit_authentication_request_authenticate(request, NULL);
	}
	return TRUE;
}

void WebView::InitExtensions(WebKitWebContext* context, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->contextSignalId) {
		g_signal_handler_disconnect(context, self->contextSignalId);
		self->contextSignalId = 0;
	}
	webkit_web_context_set_web_extensions_directory(context, self->extensionsDirectory);
	GVariant* userData = g_variant_new("(s)", self->cstamp);
	webkit_web_context_set_web_extensions_initialization_user_data(context, userData);
}

gboolean WebView::DecidePolicy(WebKitWebView* web_view, WebKitPolicyDecision* decision, WebKitPolicyDecisionType type, gpointer data) {
	Nan::HandleScope scope;
	WebView* self = (WebView*)data;
	if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
		WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		WebKitNavigationAction* navAction = webkit_navigation_policy_decision_get_navigation_action(navDecision);
		WebKitURIRequest* navRequest = webkit_navigation_action_get_request(navAction);
		Local<String> uri = Nan::New<String>(webkit_uri_request_get_uri(navRequest)).ToLocalChecked();
		Local<String> type = Nan::New<String>("navigation").ToLocalChecked();
		Local<Value> argv[] = { type, uri };
		Local<Value> ignore = Nan::Call(*(self->policyCallback), 2, argv).ToLocalChecked();
		if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
			webkit_policy_decision_ignore(decision);
			return TRUE;
		}
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
		// ignore for now
		webkit_policy_decision_ignore(decision);
		return TRUE;
		// WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		// WebKitURIRequest* navRequest = webkit_navigation_policy_decision_get_request(navDecision);
		// const gchar* uri = webkit_uri_request_get_uri(navRequest);
		// g_log("policy new window decision for\n%s\n", uri);
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
		WebKitResponsePolicyDecision* resDecision = WEBKIT_RESPONSE_POLICY_DECISION(decision);
		if (webkit_response_policy_decision_is_mime_type_supported(resDecision) == FALSE) {
			// requests are not expected to be cancelled
			return TRUE;
		}
	}
	return FALSE;
}

void WebView::handleEventMessage(WebKitUserContentManager* contman, WebKitJavascriptResult* js_result, gpointer data) {
	if (data == NULL) return;
	ViewClosure* vc = (ViewClosure*)data;
	if (vc->closure == NULL) return;
	WebView* self = (WebView*)(vc->view);
	JSGlobalContextRef context = webkit_javascript_result_get_global_context(js_result);
	JSValueRef value = webkit_javascript_result_get_value(js_result);
	gchar* str_value = NULL;
	Nan::HandleScope scope;
	if (JSValueIsString(context, value)) {
		JSStringRef js_str_value = JSValueToStringCopy(context, value, NULL);
		gsize str_length = JSStringGetMaximumUTF8CStringSize(js_str_value);
		str_value = (gchar*)g_malloc(str_length);
		JSStringGetUTF8CString(js_str_value, str_value, str_length);
		JSStringRelease(js_str_value);
		Local<Value> argv[] = {
			Nan::Null(),
			Nan::New<String>(str_value).ToLocalChecked()
		};
		Nan::Call(*(self->eventsCallback), 2, argv);
	} else {
		g_warning("Error in script message handler: unexpected js_result value");
	}
	if (str_value != NULL) g_free(str_value);
	webkit_javascript_result_unref(js_result);
}

void WebView::ResourceLoad(WebKitWebView* web_view, WebKitWebResource* resource, WebKitURIRequest* request, gpointer data) {
	g_signal_connect(resource, "finished", G_CALLBACK(WebView::ResourceResponse), data);
	g_signal_connect(resource, "received-data", G_CALLBACK(WebView::ResourceReceiveData), data);
}

void WebView::ResourceReceiveData(WebKitWebResource* resource, guint64 length, gpointer data) {
	if (data == NULL) return;
	ViewClosure* vc = (ViewClosure*)data;
	if (vc->closure == NULL) return;
	WebView* self = (WebView*)(vc->view);
	WebKitURIResponse* response = webkit_web_resource_get_response(resource);
	Nan::HandleScope scope;
	Local<Object> obj = Nan::NewInstance(Nan::GetFunction(Nan::New(WebResponse::constructor)).ToLocalChecked()).ToLocalChecked();
	WebResponse* selfResponse = node::ObjectWrap::Unwrap<WebResponse>(obj);
	selfResponse->init(resource, response);

	int argc = 3;
	Local<Value> argv[] = {
		Nan::New<String>((char*)vc->closure).ToLocalChecked(),
		obj,
		Nan::New<Integer>((int)length)
	};
	Nan::Call(*(self->receiveDataCallback), argc, argv);
}

void WebView::ResourceResponse(WebKitWebResource* resource, gpointer data) {
	if (data == NULL) return;
	ViewClosure* vc = (ViewClosure*)data;
	if (vc->closure == NULL) return;
	WebView* self = (WebView*)(vc->view);
	WebKitURIResponse* response = webkit_web_resource_get_response(resource);
	Nan::HandleScope scope;
	Local<Object> obj = Nan::NewInstance(Nan::GetFunction(Nan::New(WebResponse::constructor)).ToLocalChecked()).ToLocalChecked();
	WebResponse* selfResponse = node::ObjectWrap::Unwrap<WebResponse>(obj);
	selfResponse->init(resource, response);
	int argc = 2;
	Local<Value> argv[] = {
		Nan::New<String>((char*)vc->closure).ToLocalChecked(),
		obj
	};
	Nan::Call(*(self->responseCallback), argc, argv);
}

gboolean WebView::ScriptDialog(WebKitWebView* web_view, WebKitScriptDialog* dialog, WebView* self) {
	if (!self->allowDialogs) return TRUE;
	else return FALSE;
}

void WebView::updateUri(const gchar* uri) {
	if (uri != NULL) {
		if (this->uri != NULL) g_free(this->uri);
		this->uri = g_strdup(uri);
	}
}

guint getStatusFromView(WebKitWebView* web_view) {
	WebKitWebResource* resource = webkit_web_view_get_main_resource(web_view);
	if (resource != NULL) {
		WebKitURIResponse* response = webkit_web_resource_get_response(resource);
		if (response != NULL) {
			return webkit_uri_response_get_status_code(response);
		}
	}
	return 0;
}

bool WebView::stop(bool nowait, GError* err) {
	Nan::HandleScope scope;
	bool handled = FALSE;
	if (this->stopCallback != NULL) {
		Local<Value> argvstop[] = {
			Nan::New<Boolean>(this->loadCallback != NULL)
		};
		Nan::Call(*(this->stopCallback), 1, argvstop);
		delete this->stopCallback;
		this->stopCallback = NULL;
		handled = TRUE;
	}
	if (nowait && this->loadCallback != NULL) {
		Local<Value> argv[2] = {};
		if (err != NULL) {
			argv[0] = Nan::Error(err->message);
			this->state = DOCUMENT_ERROR;
		} else {
			argv[0] = Nan::Null();
		}
		int status = 0;
		if (!handled) status = getStatusFromView(view);
		if (status == 0 && this->userContent == TRUE) status = 200;
		argv[1] = Nan::New<Integer>(status);
		Nan::Call(*(this->loadCallback), 2, argv);
		delete this->loadCallback;
		this->loadCallback = NULL;
		handled = TRUE;
	}
	return handled;
}

void WebView::Change(WebKitWebView* web_view, WebKitLoadEvent load_event, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::HandleScope scope;
	Nan::Callback* cb;
	const gchar* uri = webkit_web_view_get_uri(web_view);
	// g_message("change %d %d %s %s\n", load_event, self->state, self->uri, uri);
	switch (load_event) {
		case WEBKIT_LOAD_STARTED: // 0
			/* New load, we have now a provisional URI */
			// provisional_uri = webkit_web_view_get_uri (web_view);
			/* Here we could start a spinner or update the
			* location bar with the provisional URI */
			self->state = DOCUMENT_LOADING;
			self->updateUri(uri);
		break;
		case WEBKIT_LOAD_REDIRECTED: // 1
			// redirected_uri = webkit_web_view_get_uri (web_view);
			if (self->state == DOCUMENT_LOADING) self->updateUri(uri);
		break;
		case WEBKIT_LOAD_COMMITTED: // 2
			/* The load is being performed. Current URI is
			* the final one and it won't change unless a new
			* load is requested or a navigation within the
			* same page is performed */
			if (self->state == DOCUMENT_LOADING) {
				self->state = DOCUMENT_LOADED;
				self->updateUri(uri);
				self->stop(self->waitFinish == FALSE && self->stopCallback == NULL);
			}
		break;
		case WEBKIT_LOAD_FINISHED: // 3
			self->state = DOCUMENT_AVAILABLE;
			self->stop(self->waitFinish == TRUE);
		break;
	}
}

gboolean WebView::Fail(WebKitWebView* web_view, WebKitLoadEvent load_event, gchar* failing_uri, GError* error, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::HandleScope scope;
	Nan::Callback* cb;
	return self->stop(
		self->state >= DOCUMENT_COMMITED && g_strcmp0(failing_uri, self->uri) == 0,
		error
	);
}

NAN_METHOD(WebView::New) {
	Nan::HandleScope scope;
	WebView* self = new WebView(info[0]->ToObject());
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}

NAN_METHOD(WebView::Load) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (!info[3]->IsFunction()) {
		Nan::ThrowError("load(uri, opts, cb) missing cb argument");
		return;
	}
	Nan::Callback* loadCb = new Nan::Callback(info[3].As<Function>());

	if (self->state == DOCUMENT_COMMITED) {
		Local<Value> argv[] = {
			Nan::Error("A document is already being loaded")
		};
		if (loadCb != NULL) {
			Nan::Call(*loadCb, 1, argv);
			delete loadCb;
		}
		return;
	}

	if (!info[0]->IsString()) {
		Local<Value> argv[] = {
			Nan::Error("load(uri, opts, cb) expected a string for uri argument")
		};
		if (loadCb != NULL) {
			Nan::Call(*loadCb, 1, argv);
			delete loadCb;
		}
		return;
	}

	Nan::Utf8String* uri = new Nan::Utf8String(info[0]);

	Local<Object> opts = info[2]->ToObject();

	if (NanBooleanOptionValue(opts, H("transparent"), false) == TRUE) {
		if (self->transparencySupport == FALSE) {
			g_warning("Background cannot be transparent: rgba visual not found and/or webkitgtk >= 2.7.4 required");
		} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
			static const GdkRGBA transparent = {.0, .0, .0, .0};
			webkit_web_view_set_background_color(self->view, &transparent);
	#endif
		}
	} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
		static const GdkRGBA opaque = {1.0, 1.0, 1.0, 1.0};
		webkit_web_view_set_background_color(self->view, &opaque);
	#endif
		// nothing to do
	}
	// default to decorated if not offscreen
	if (!self->offscreen) {
		gtk_window_set_decorated(GTK_WINDOW(self->window), NanBooleanOptionValue(opts, H("decorated"), TRUE));
	}

	int w = NanUInt32OptionValue(opts, H("width"), 1024);
	int h = NanUInt32OptionValue(opts, H("height"), 768);
	gtk_window_set_default_size(GTK_WINDOW(self->window), w, h);
	gtk_window_resize(GTK_WINDOW(self->window), w, h);

	WebKitSettings* settings = webkit_web_view_get_settings(self->view);

	// sane defaults for headless usage
	g_object_set(settings,
		"enable-plugins", FALSE,
		"enable-html5-database", FALSE,
		"enable-html5-local-storage", FALSE,
		"enable-java", FALSE,
		"enable-page-cache", FALSE,
		"enable-offline-web-application-cache", FALSE,
		NULL
	);

	Local<v8::Array> optsProps = Nan::GetOwnPropertyNames(opts).ToLocalChecked();
	Local<v8::Value> optsName;
	Local<v8::Value> optsVal;
	GParamSpec* spec;
	for (guint optsIndex = 0; optsIndex < optsProps->Length(); optsIndex++) {
		optsName = Nan::Get(optsProps, optsIndex).ToLocalChecked();
		gchar* optsNameStr = *(Nan::Utf8String(optsName));
		spec = g_object_class_find_property(G_OBJECT_GET_CLASS(settings), optsNameStr);
		if (spec != NULL) {
			optsVal = Nan::Get(opts, optsName).ToLocalChecked();
			if (G_IS_PARAM_SPEC_BOOLEAN(spec) && optsVal->IsBoolean()) {
				g_object_set(settings, spec->name, optsVal->BooleanValue(), NULL);
			} else if (G_IS_PARAM_SPEC_STRING(spec) && optsVal->IsString()) {
				g_object_set(settings, spec->name, *(Nan::Utf8String(optsVal)), NULL);
			} else if (G_IS_PARAM_SPEC_UINT(spec) && optsVal->IsUint32()) {
				g_object_set(settings, spec->name, optsVal->Uint32Value(), NULL);
			} else if (!optsVal->IsUndefined()) {
				g_warning("Ignored opt name %s", spec->name);
			}
		}
	}

	self->allowDialogs = NanBooleanOptionValue(opts, H("dialogs"), false);

	if (self->loadCallback != NULL) {
		g_error("load callback is still set, this should not happen");
		delete self->loadCallback;
	}

	if (self->state == DOCUMENT_LOADED) webkit_web_view_stop_loading(self->view);

	self->unloaded();

	self->loadCallback = loadCb;

	if (NanBooleanOptionValue(opts, H("clearCookies"), FALSE)) {
		webkit_cookie_manager_delete_all_cookies(webkit_web_context_get_cookie_manager(self->context));
	}

	WebKitUserContentManager* contman = webkit_web_view_get_user_content_manager(self->view);

	ViewClosure* vc = new ViewClosure(self, info[1]->IsString() ? **(new Nan::Utf8String(info[1])) : NULL);

	self->idEventsHandler = g_signal_connect(
		contman,
		"script-message-received::events",
		G_CALLBACK(WebView::handleEventMessage),
		vc
	);

	webkit_user_content_manager_register_script_message_handler(contman, "events");

	self->idResourceResponse = g_signal_connect(
		self->view,
		"resource-load-started",
		G_CALLBACK(WebView::ResourceLoad),
		vc
	);

	self->state = DOCUMENT_COMMITED;
	self->updateUri(**uri);

	Nan::Utf8String* script = getOptStr(opts, "script");
	if (script->length() > 0) {
		self->userScript = webkit_user_script_new(
			**script,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
			NULL, NULL
		);
		webkit_user_content_manager_add_script(contman, self->userScript);
		webkit_user_script_unref(self->userScript);
		self->userScript = NULL;
		script = NULL;
	}

	Nan::Utf8String* style = getOptStr(opts, "style");
	if (style->length() > 0) {
		self->userStyleSheet = webkit_user_style_sheet_new(
			**style,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_STYLE_LEVEL_USER,
			NULL, NULL
		);
		webkit_user_content_manager_add_style_sheet(contman, self->userStyleSheet);
		webkit_user_style_sheet_unref(self->userStyleSheet);
		self->userStyleSheet = NULL;
		script = NULL;
	}
	self->waitFinish = NanBooleanOptionValue(opts, H("waitFinish"), FALSE);

	Nan::Utf8String* content = getOptStr(opts, "content");

	gboolean isEmpty = g_strcmp0(**uri, "") == 0;

	if (isEmpty || content->length() > 0) {
		self->userContent = TRUE;
		if (isEmpty) {
			g_free(self->uri);
			self->uri = NULL;
		}
		webkit_web_view_load_bytes(
			self->view,
			g_bytes_new_take(**content, content->length()), "text/html",
			webkit_settings_get_default_charset(settings),
			self->uri
		);
	} else {
		self->userContent = FALSE;
		webkit_web_view_load_uri(self->view, self->uri);
	}
	delete content;
}

void WebView::GeometryChanged(WebKitWindowProperties* properties, GParamSpec* pspec, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->resizing == FALSE) return;
	GdkRectangle geometry;
	webkit_window_properties_get_geometry(properties, &geometry);
	if (geometry.x >= 0 && geometry.y >= 0) {
		gtk_window_move(GTK_WINDOW(self->window), geometry.x, geometry.y);
	}

	if (geometry.width > 0 && geometry.height > 0) {
		gtk_window_resize(GTK_WINDOW(self->window), geometry.width, geometry.height);
	}
}

void WebView::RunFinished(GObject* object, GAsyncResult* result, gpointer data) {
	GError* error = NULL;
	ViewClosure* vc = (ViewClosure*)data;
	WebView* self = (WebView*)(vc->view);
	WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), result, &error);
	if (js_result == NULL) { // if NULL, error is defined
		Nan::HandleScope scope;
		Nan::Utf8String* nStr = (Nan::Utf8String*)(vc->closure);
		Local<Value> argv[] = {
			Nan::Error(error->message),
			Nan::New<String>(**nStr).ToLocalChecked()
		};
		Nan::Call(*(self->eventsCallback), 2, argv);
		g_error_free(error);
		delete nStr;
	} else {
		webkit_javascript_result_unref(js_result);
	}
	delete vc;
}

NAN_METHOD(WebView::Run) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (!info[0]->IsString()) {
		Nan::ThrowError("run(script, ticket) missing script argument");
		return;
	}

	Nan::Utf8String* script = new Nan::Utf8String(info[0]);

	ViewClosure* vc = new ViewClosure(self, new Nan::Utf8String(info[1]));

	if (self->view != NULL) {
		webkit_web_view_run_javascript(
			self->view,
			**script,
			NULL,
			WebView::RunFinished,
			vc
		);
	}
	delete script;
}

void WebView::RunSyncFinished(GObject* object, GAsyncResult* result, gpointer data) {
	GError* error = NULL;
	ViewClosure* vc = (ViewClosure*)data;
	WebView* self = (WebView*)(vc->view);
	if (WEBKIT_IS_WEB_VIEW(object) == FALSE) return;
	WebKitWebView* pView = WEBKIT_WEB_VIEW(object);
	if (pView != self->view) return;
	Nan::HandleScope scope;
	WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(pView, result, &error);

	if (js_result == NULL) { // if NULL, error is defined
		Nan::Utf8String* nStr = (Nan::Utf8String*)(vc->closure);
		Local<Value> argv[] = {
			Nan::Error(error->message),
			Nan::New<String>(**nStr).ToLocalChecked()
		};
		Nan::Call(*(self->eventsCallback), 2, argv);
		g_error_free(error);
		delete nStr;
		delete vc;
		return;
	}

	JSGlobalContextRef context = webkit_javascript_result_get_global_context(js_result);
	JSValueRef value = webkit_javascript_result_get_value(js_result);
	gchar* str_value = NULL;
	if (JSValueIsString(context, value)) {
		JSStringRef js_str_value = JSValueToStringCopy(context, value, NULL);
		gsize str_length = JSStringGetMaximumUTF8CStringSize(js_str_value);
		str_value = (gchar*)g_malloc(str_length);
		JSStringGetUTF8CString(js_str_value, str_value, str_length);
		JSStringRelease(js_str_value);
		Local<Value> argv[] = {
			Nan::Null(),
			Nan::New<String>(str_value).ToLocalChecked()
		};
		Nan::Call(*(self->eventsCallback), 2, argv);
	} else {
		// this can actually happen when invoking runSync directly
	}
	if (str_value != NULL) g_free(str_value);
	webkit_javascript_result_unref(js_result);
	delete vc;
}

NAN_METHOD(WebView::RunSync) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (!info[0]->IsString()) {
		Nan::ThrowError("runSync(script, ticket) missing script argument");
		return;
	}
	Nan::Utf8String* script = new Nan::Utf8String(info[0]);
	ViewClosure* vc = new ViewClosure(self, new Nan::Utf8String(info[1]));
	if (self->view != NULL) {
		webkit_web_view_run_javascript(
			self->view,
			**script,
			NULL,
			WebView::RunSyncFinished,
			vc
		);
	}
	delete script;
}

cairo_status_t WebView::PngWrite(void* closure, const unsigned char* data, unsigned int length) {
	WebView* self = (WebView*)closure;
	Nan::HandleScope scope;
	Nan::MaybeLocal<v8::Object> buff = Nan::CopyBuffer(
		reinterpret_cast<char*>(const_cast<unsigned char*>(data)),
		length
	);
	Local<Value> argv[] = {
		Nan::Null(),
		buff.ToLocalChecked()
	};
	Nan::Call(*(self->pngCallback), 2, argv);
	return CAIRO_STATUS_SUCCESS;
}

void WebView::PngFinished(GObject* object, GAsyncResult* result, gpointer data) {
	WebView* self = (WebView*)data;
	GError* error = NULL;
	cairo_surface_t* surface = webkit_web_view_get_snapshot_finish(self->view, result, &error);
	cairo_status_t status = CAIRO_STATUS_SUCCESS;
	if (error == NULL) {
		status = cairo_surface_write_to_png_stream(surface, WebView::PngWrite, data);
	} else {
		status = CAIRO_STATUS_INVALID_STATUS;
	}
	Nan::HandleScope scope;
	Local<Value> argv[1] = {};
	if (status == CAIRO_STATUS_SUCCESS) {
		argv[0] = Nan::Null();
	} else if (error != NULL && error->message != NULL) {
		argv[0] = Nan::Error(error->message);
	} else {
		argv[0] = Nan::Error(cairo_status_to_string(status));
	}
	Nan::Call(*(self->pngCallback), 1, argv);
	delete self->pngCallback;
	self->pngCallback = NULL;
}

NAN_METHOD(WebView::Png) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (!info[0]->IsFunction()) {
		Nan::ThrowError("png(cb) missing cb argument");
		return;
	}
	if (self->pngCallback != NULL) {
		Nan::ThrowError("cannot call png(cb) while another call is not yet finished");
		return;
	}
	self->pngCallback = new Nan::Callback(info[0].As<Function>());
	webkit_web_view_get_snapshot(
		self->view,
		WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT,
		snapshot_options,
		NULL, //	GCancellable
		WebView::PngFinished,
		self
	);
	return;
}

void WebView::PrintFinished(WebKitPrintOperation* op, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->printUri == NULL) return;
	Nan::HandleScope scope;
	Local<Value> argv[] = {};
	Nan::Call(*(self->printCallback), 0, argv);
	delete self->printCallback;
	self->printCallback = NULL;
	delete self->printUri;
	self->printUri = NULL;
}
void WebView::PrintFailed(WebKitPrintOperation* op, gpointer error, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::HandleScope scope;
	Local<Value> argv[] = {
		Nan::Error(((GError*)error)->message)
	};
	Nan::Call(*(self->printCallback), 1, argv);
	delete self->printCallback;
	self->printCallback = NULL;
	delete self->printUri;
	self->printUri = NULL;
}

static gboolean find_file_printer(GtkPrinter* printer, char** data) {
	if (!g_strcmp0(G_OBJECT_TYPE_NAME(gtk_printer_get_backend(printer)), "GtkPrintBackendFile")) {
		*data = strdup(gtk_printer_get_name(printer));
		return TRUE;
	}
	return FALSE;
}

static GtkUnit getUnit(gchar* name) {
	if (g_strcmp0(name, "mm") == 0) {
		return GTK_UNIT_MM;
	} else if (g_strcmp0(name, "in") == 0) {
		return GTK_UNIT_INCH;
	} else {
		return GTK_UNIT_POINTS;
	}
}

NAN_METHOD(WebView::Print) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (self->printUri != NULL) {
		Nan::ThrowError("print() can be executed only one at a time");
		return;
	}
	if (!info[0]->IsString()) {
		Nan::ThrowError("print(filename, opts, cb) missing filename argument");
		return;
	}
	self->printUri = new Nan::Utf8String(info[0]);
	if (!info[2]->IsFunction()) {
		Nan::ThrowError("print(filename, opts, cb) missing cb argument");
		return;
	}
	self->printCallback = new Nan::Callback(info[2].As<Function>());
	Local<Object> opts = info[1]->ToObject();

	WebKitPrintOperation* op = webkit_print_operation_new(self->view);

	GtkPageSetup* setup = gtk_page_setup_new();

	GtkPaperSize* paperSize;
	Nan::Utf8String* paperStr = NULL;
	Nan::Utf8String* unitStr = NULL;

	Local<Value> paperVal = opts->Get(H("paper"));
	if (paperVal->IsString()) {
		paperStr = new Nan::Utf8String(paperVal);
		paperSize = gtk_paper_size_new(**paperStr);
	} else if (paperVal->IsObject()) {
		Local<Object> paperObj = paperVal->ToObject();
		unitStr = getOptStr(paperObj, "unit");
		paperSize = gtk_paper_size_new_custom(
			"custom",
			"custom",
			NanUInt32OptionValue(paperObj, H("width"), 0),
			NanUInt32OptionValue(paperObj, H("height"), 0),
			getUnit(**unitStr)
		);
	} else {
		paperSize = gtk_paper_size_new(gtk_paper_size_get_default());
	}

	gtk_page_setup_set_paper_size_and_default_margins(setup, paperSize);

	Local<Value> marginsVal = opts->Get(H("margins"));
	GtkUnit marginUnit = GTK_UNIT_POINTS;
	gdouble defaultMargin = 0;
	Local<Object> marginsObj;
	if (marginsVal->IsNumber()) {
		defaultMargin = marginsVal->NumberValue();
	} else if (marginsVal->IsObject()) {
		marginsObj = marginsVal->ToObject();
		marginUnit = getUnit(**getOptStr(marginsObj, "unit"));
	}
	gtk_page_setup_set_left_margin(setup,
		NanUInt32OptionValue(marginsObj, H("left"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_top_margin(setup,
		NanUInt32OptionValue(marginsObj, H("top"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_right_margin(setup,
		NanUInt32OptionValue(marginsObj, H("right"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_bottom_margin(setup,
		NanUInt32OptionValue(marginsObj, H("bottom"), defaultMargin),
		marginUnit);

	GtkPageOrientation orientation = GTK_PAGE_ORIENTATION_PORTRAIT;
	Nan::Utf8String* orientationStr = getOptStr(opts, "orientation");
	if (g_strcmp0(**orientationStr, "landscape") == 0) {
		orientation = GTK_PAGE_ORIENTATION_LANDSCAPE;
	}
	gtk_page_setup_set_orientation(setup, orientation);

	webkit_print_operation_set_page_setup(op, setup);

	// settings
	GtkPrintSettings* settings = gtk_print_settings_new();
	gtk_print_settings_set_quality(settings, GTK_PRINT_QUALITY_HIGH);

	char* printer = NULL;
	gtk_enumerate_printers((GtkPrinterFunc)find_file_printer, &printer, NULL, TRUE);
	gtk_print_settings_set_printer(settings, printer);
	delete printer;
	gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, **self->printUri);

	webkit_print_operation_set_print_settings(op, settings);

	// print
	g_signal_connect(op, "failed", G_CALLBACK(WebView::PrintFailed), self);
	g_signal_connect(op, "finished", G_CALLBACK(WebView::PrintFinished), self);
	webkit_print_operation_print(op);
	g_object_unref(op);
	g_object_unref(settings);
	if (paperStr != NULL) delete paperStr;
	if (unitStr != NULL) delete unitStr;
	delete orientationStr;
	return;
}

NAN_GETTER(WebView::get_prop) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	std::string propstr = TOSTR(property);

	if (propstr == "uri") {
		if (self->uri != NULL) info.GetReturnValue().Set(Nan::New<String>(self->uri).ToLocalChecked());
		else return;
	} else {
		return;
	}
}

NAN_METHOD(WebView::Inspect) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (self->inspector != NULL) {
		webkit_web_inspector_show(self->inspector);
	}
	return;
}

void WebView::Exit(void*) {
	Nan::HandleScope scope;
	for (ObjMap::iterator it = instances.begin(); it != instances.end(); it++) {
		if (it->second != NULL) it->second->destroy();
	}
	instances.clear();
}


NODE_MODULE(webkitgtk, WebView::Init)

