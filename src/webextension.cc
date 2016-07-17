#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JavaScript.h>
#include <string.h>
#include <soup.h>
#include "utils.h"

static WebKitWebExtension* extension;

static guint idLogHandler = 0;
static guint idSendRequestHandler = 0;
static guint idPageCreatedHandler = 0;
static gboolean DEBUG = FALSE;

#if (!GLIB_CHECK_VERSION (2, 44, 0))
gboolean g_strv_contains (const gchar* const* strv, const gchar* str) {
	g_return_val_if_fail(strv != NULL, FALSE);
	g_return_val_if_fail(str != NULL, FALSE);
	for (; *strv != NULL; strv++) {
		if (g_str_equal (str, *strv)) return TRUE;
	}
	return FALSE;
}
#endif

static gchar* JSValueToStr(JSGlobalContextRef context, JSValueRef val) {
	JSStringRef js_str_value = JSValueToStringCopy(context, val, NULL);
	gsize str_length = JSStringGetMaximumUTF8CStringSize(js_str_value);
	gchar* str_value = (gchar*)g_malloc(str_length);
	JSStringGetUTF8CString(js_str_value, str_value, str_length);
	JSStringRelease(js_str_value);
	return str_value;
}

static gboolean web_page_send_request(WebKitWebPage* page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	gchar* cstamp = (gchar*)data;
	const gchar* uri = webkit_uri_request_get_uri(request);
	const gchar* pageUri = webkit_web_page_get_uri(page);

	// always allow and do not report: empty, blank, documentURI
	if (
		uri == NULL || pageUri == NULL
		|| g_strcmp0(uri, "") == 0
		|| g_strcmp0(uri, "about:blank") == 0
		|| g_strcmp0(uri, pageUri) == 0
	) return FALSE;

	JSValueRef result;
	JSValueRef exception;
	gboolean hasHandler = FALSE;
	JSGlobalContextRef jsContext = webkit_frame_get_javascript_context_for_script_world(
		webkit_web_page_get_main_frame(page),
		webkit_script_world_get_default()
	);

	const char* funcStr = g_strconcat("window.request_", cstamp, NULL);

	JSStringRef funcScript = JSStringCreateWithUTF8CString(g_strconcat("!!(", funcStr, ")", NULL));
	exception = NULL;
	result = JSEvaluateScript(
		jsContext,
		funcScript,
		NULL, // JSObjectRef thisObject
		NULL, // JSStringRef sourceURL
		0, // int startingLineNumber
		&exception  // JSValueRef* exception
	);
	if (exception != NULL) {
		gchar* exceptionStr = JSValueToStr(jsContext, exception);
		g_warning("%s, while checking availability of filter function handler", exceptionStr);
		g_free(exceptionStr);
	}
	if (JSValueIsBoolean(jsContext, result)) {
		hasHandler = JSValueToBoolean(jsContext, result);
	} else {
		g_warning("Invalid value returned while checking availability of filter function handler");
	}

	if (hasHandler == FALSE) {
		g_message("No filter handler %s available to check %s", funcStr, uri);
		return FALSE;
	}

	const gchar* redirect = "";

	if (redirected_response != NULL) {
		g_message("request %s is redirected to %s", uri, webkit_uri_response_get_uri(redirected_response));
		redirect = webkit_uri_response_get_uri(redirected_response);
	}

	const gchar* scriptStr = g_strconcat(funcStr,
		"(\"", g_strescape(uri, NULL), "\",\"",
		g_strescape(redirect, NULL), "\")",
		NULL);
	JSStringRef script = JSStringCreateWithUTF8CString(scriptStr);
	exception = NULL;
	result = JSEvaluateScript(
		jsContext,
		script,
		NULL, // JSObjectRef thisObject
		NULL, // JSStringRef sourceURL
		0, // int startingLineNumber
		&exception  // JSValueRef* exception
	);

	if (exception != NULL) {
		gchar* exceptionStr = JSValueToStr(jsContext, exception);
		g_warning("%s, while running filter function handler", exceptionStr);
		g_free(exceptionStr);
	}

	if (JSValueIsBoolean(jsContext, result)) {
		if (JSValueToBoolean(jsContext, result)) {
			// go through
			g_message("accept %s", uri);
		} else {
			g_message("reject %s", uri);
			webkit_uri_request_set_uri(request, g_strconcat("#", uri, NULL));
			return TRUE;
		}
	} else if (JSValueIsString(jsContext, result)) {
		gchar* str_value = JSValueToStr(jsContext, result);
		g_message("rewrite %s to %s", uri, str_value);
		webkit_uri_request_set_uri(request, str_value);
		g_free(str_value);
	} else {
		// no return value - meaning ignore the request
		g_message("ignore %s", uri);
	}

	return FALSE;
}


static void web_page_created_callback(WebKitWebExtension* ext, WebKitWebPage* web_page, gpointer data) {
	g_message("page created");
	if (idSendRequestHandler > 0) {
		g_signal_handler_disconnect(web_page, idSendRequestHandler);
		idSendRequestHandler = 0;
	}
	idSendRequestHandler = g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

static void ttyLog(const gchar *log_domain, GLogLevelFlags log_level, const gchar *message, gpointer user_data) {
	if ((log_level & G_LOG_LEVEL_WARNING) == 0 && DEBUG == FALSE) return;
	FILE* ftty = fopen("/dev/tty", "a");
	if (ftty == NULL) {
		return;
	}
	fprintf(ftty, "%s\n", message);
	fclose(ftty);
}

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* ext, const GVariant* constData) {
		const gchar* envDebug = g_getenv("DEBUG");
		if (envDebug != NULL) {
			gchar** envStrv = g_strsplit(envDebug, ",", -1);
			if (g_strv_contains(envStrv, "webkitgtk:extension")) {
				DEBUG = TRUE;
			}
			g_strfreev(envStrv);
		}

		extension = ext;
		idLogHandler = g_log_set_handler(
			NULL,
			G_LOG_LEVEL_MASK,
			ttyLog,
			NULL
		);
		gchar* cstamp;
		g_variant_get((GVariant*)constData, "(s)", &cstamp);
		idPageCreatedHandler = g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), cstamp);
	}
}



static void __attribute__((destructor))
webkit_web_extension_destroy (void) {
	g_message("extension destroyed");
	g_log_remove_handler(NULL, idLogHandler);

	if (idPageCreatedHandler > 0) {
		g_signal_handler_disconnect(extension, idPageCreatedHandler);
		idPageCreatedHandler = 0;
	}
	g_object_unref(extension);
	extension = NULL;
}
