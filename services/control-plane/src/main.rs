use std::{net::SocketAddr, path::PathBuf, time::Duration};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let address: SocketAddr = std::env::var("PAAS_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    let ui_dir = PathBuf::from(
        std::env::var_os("PAAS_UI_DIR").unwrap_or_else(|| "/usr/share/homelab-paas/ui".into()),
    );
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(operation = "serve", %address, "control plane listening");
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = axum::serve(listener, control_plane::app(ui_dir)).with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });
    let mut server = Box::pin(std::future::IntoFuture::into_future(server));
    tokio::select! {
        result = &mut server => result?,
        () = shutdown() => {
            let _ = shutdown_tx.send(());
            match tokio::time::timeout(Duration::from_secs(10), server).await {
                Ok(result) => result?,
                Err(_) => tracing::warn!(operation = "shutdown", "HTTP drain deadline reached"),
            }
        }
    }
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    let result = async {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(()),
        }
    }
    .await;
    #[cfg(not(unix))]
    let result = tokio::signal::ctrl_c().await;
    if let Err(error) = result {
        tracing::error!(operation = "shutdown", %error, "signal handler failed");
    }
    tracing::info!(operation = "shutdown", "draining HTTP connections");
}
