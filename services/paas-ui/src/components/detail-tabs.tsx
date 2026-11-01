import { Activity, FileCode, KeyRound, LayoutDashboard, ListTree, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const DetailTabs = ({
	base,
	label,
	tabs,
	current,
}: {
	base: string;
	label: string;
	tabs: { path: string; label: string; icon: LucideIcon }[];
	current: string;
}) => (
	<nav className='tabs' aria-label={label}>
		{tabs.map(({ icon: Icon, ...tab }) => (
			<a key={tab.path} href={`${base}${tab.path}`} aria-current={tab.path === current ? "page" : undefined}>
				<Icon aria-hidden='true' />
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
	tab: "overview" | "resources" | "events" | "secrets" | "descriptor";
}) => (
	<DetailTabs
		base={`#/services/${serviceId}`}
		label='Service detail'
		current={tab === "overview" ? "" : `/${tab}`}
		tabs={[
			{ path: "", label: "Overview", icon: LayoutDashboard },
			{ path: "/resources", label: "Resources", icon: ListTree },
			{ path: "/descriptor", label: "Descriptor", icon: FileCode },
			{ path: "/events", label: "Events", icon: Activity },
			{ path: "/secrets", label: "Secrets", icon: KeyRound },
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
			{ path: "/config", label: "Overview", icon: LayoutDashboard },
			{ path: "/logs", label: "Logs", icon: ScrollText },
			{ path: "/events", label: "Events", icon: Activity },
		]}
	/>
);
