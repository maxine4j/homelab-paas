export const DetailTabs = ({
	base,
	label,
	tabs,
	current,
}: {
	base: string;
	label: string;
	tabs: { path: string; label: string }[];
	current: string;
}) => (
	<nav className='tabs' aria-label={label}>
		{tabs.map((tab) => (
			<a key={tab.path} href={`${base}${tab.path}`} aria-current={tab.path === current ? "page" : undefined}>
				{tab.label}
			</a>
		))}
	</nav>
);

export const ServiceDetailTabs = ({
	serviceId,
	tab,
}: {
	serviceId: string;
	tab: "overview" | "resources" | "events";
}) => (
	<DetailTabs
		base={`#/services/${serviceId}`}
		label='Service detail'
		current={tab === "overview" ? "" : `/${tab}`}
		tabs={[
			{ path: "", label: "Overview" },
			{ path: "/resources", label: "Resources" },
			{ path: "/events", label: "Events" },
		]}
	/>
);

export const ResourceDetailTabs = ({
	serviceId,
	resourceId,
	tab,
}: {
	serviceId: string;
	resourceId: string;
	tab: "config" | "logs" | "events";
}) => (
	<DetailTabs
		base={`#/services/${serviceId}/resources/${resourceId}`}
		label='Resource inspection'
		current={`/${tab}`}
		tabs={[
			{ path: "/config", label: "Overview" },
			{ path: "/logs", label: "Logs" },
			{ path: "/events", label: "Events" },
		]}
	/>
);
