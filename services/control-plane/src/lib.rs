use std::path::PathBuf;

use axum::{
    Router,
    body::Body,
    http::{HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use tower::ServiceExt;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

/// The MVP health endpoint reports process liveness, not cluster readiness.
pub fn app(ui_dir: PathBuf) -> Router {
    let assets = ServeDir::new(ui_dir.join("assets"));
    let index = ui_dir.join("index.html");
    let spa = ServeDir::new(&ui_dir).fallback(get(move |request: Request<Body>| {
        let index = index.clone();
        async move {
            if request
                .uri()
                .path()
                .rsplit('/')
                .next()
                .is_some_and(|name| name.contains('.'))
            {
                return Ok::<_, std::convert::Infallible>(StatusCode::NOT_FOUND.into_response());
            }
            ServeFile::new(index)
                .oneshot(request)
                .await
                .map(|response| response.map(Body::new))
        }
    }));

    Router::new()
        .route("/api/health", get(|| async { StatusCode::OK }))
        .route("/api", get(api_not_found))
        .nest("/api", Router::new().fallback(api_not_found))
        .nest_service("/assets", assets)
        .route_service("/favicon.ico", ServeFile::new(ui_dir.join("favicon.ico")))
        .fallback_service(spa)
        .layer(middleware::from_fn(cache_policy))
        .layer(TraceLayer::new_for_http())
}

async fn api_not_found() -> StatusCode {
    StatusCode::NOT_FOUND
}

async fn cache_policy(request: Request<Body>, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/assets/");
    let mut response = next.run(request).await;
    let value = if immutable && response.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    #[tokio::test]
    async fn api_and_static_routing() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir(dir.path().join("assets"))?;
        std::fs::write(dir.path().join("index.html"), "<h1>Hello world</h1>")?;
        std::fs::write(dir.path().join("assets/app-123.js"), "console.log('hello')")?;
        let app = app(dir.path().to_path_buf());
        for (method, path, status) in [
            ("GET", "/api/health", StatusCode::OK),
            ("HEAD", "/api/health", StatusCode::OK),
            ("POST", "/api/health", StatusCode::METHOD_NOT_ALLOWED),
            ("GET", "/api", StatusCode::NOT_FOUND),
            ("GET", "/api/unknown", StatusCode::NOT_FOUND),
            ("GET", "/", StatusCode::OK),
            ("GET", "/services/example", StatusCode::OK),
            ("GET", "/assets/app-123.js", StatusCode::OK),
            ("GET", "/assets/missing.js", StatusCode::NOT_FOUND),
            ("GET", "/missing.js", StatusCode::NOT_FOUND),
            ("POST", "/", StatusCode::METHOD_NOT_ALLOWED),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .body(Body::empty())?,
                )
                .await?;
            assert_eq!(response.status(), status, "{method} {path}");
            if path.starts_with("/api") {
                assert_ne!(
                    response.headers().get(header::CONTENT_TYPE),
                    Some(&HeaderValue::from_static("text/html"))
                );
            }
        }
        Ok(())
    }
}
