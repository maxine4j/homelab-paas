import type { UiServiceEvent } from "@homelab-paas/shared-contracts";
import { useState } from "react";

export const copyEventJson = async (
	event: UiServiceEvent,
	clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<string> => {
	try {
		if (!clipboard) return "Unable to copy JSON";
		await clipboard.writeText(JSON.stringify(event, undefined, 2));
		return "Copied JSON";
	} catch {
		return "Unable to copy JSON";
	}
};

export const EventCopy = ({ event }: { event: UiServiceEvent }) => {
	const [feedback, setFeedback] = useState("");
	return (
		<div className='event-copy'>
			<span role='status'>{feedback}</span>
			<button
				type='button'
				className='text-action'
				onClick={async () => setFeedback(await copyEventJson(event, navigator.clipboard))}
			>
				Copy JSON
			</button>
		</div>
	);
};
