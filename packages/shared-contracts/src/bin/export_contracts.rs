use std::io::Write;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut output = std::io::BufWriter::new(std::io::stdout().lock());
    serde_json::to_writer_pretty(&mut output, &shared_contracts::schemas())?;
    writeln!(output)?;
    output.flush()?;
    Ok(())
}
