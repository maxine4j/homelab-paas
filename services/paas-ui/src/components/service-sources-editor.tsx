import type { ServiceSourceDraft } from "../types.ts";

export const ServiceSourcesEditor = ({
	rows,
	readOnly,
	onChange,
}: {
	rows: ServiceSourceDraft[];
	readOnly: boolean;
	onChange: (rows: ServiceSourceDraft[]) => void;
}) => (
	<div className='service-sources-editor'>
		<p>Choose each service’s Git repository and committed descriptor file.</p>
		{rows.length === 0 && <p>No services configured.</p>}
		{rows.map((row, index) => (
			<fieldset className='service-source' key={index}>
				<legend>{row.serviceId || "New service"}</legend>
				<div className='config-fields'>
					{(
						[
							["serviceId", "Service ID", "my-service"],
							["remote", "Repository", "https://github.com/owner/repo.git or local"],
							["branch", "Branch (optional)", "Repository HEAD"],
							["descriptorPath", "Descriptor path", "services/my-service.sd.yaml"],
						] as const
					).map(([key, label, placeholder]) => (
						<div className='config-field' key={key}>
							<label htmlFor={`source-${index}-${key}`}>{label}</label>
							<input
								id={`source-${index}-${key}`}
								value={row[key]}
								placeholder={placeholder}
								readOnly={readOnly}
								required={key !== "branch"}
								pattern={key === "serviceId" ? "[a-z][a-z0-9]*(-[a-z0-9]+)*" : undefined}
								onChange={(event) =>
									onChange(
										rows.map((source, position) =>
											position === index ? { ...source, [key]: event.target.value } : source,
										),
									)
								}
							/>
							{key === "descriptorPath" && row.remote === "local" && (
								<small>Absolute path inside the control-plane container</small>
							)}
						</div>
					))}
				</div>
				{!readOnly && (
					<button
						type='button'
						className='remove-service'
						onClick={() => onChange(rows.filter((_, position) => position !== index))}
					>
						Remove service
					</button>
				)}
			</fieldset>
		))}
		{!readOnly && (
			<button
				type='button'
				onClick={() => onChange([...rows, { serviceId: "", remote: "", branch: "", descriptorPath: "" }])}
			>
				Add service
			</button>
		)}
	</div>
);
