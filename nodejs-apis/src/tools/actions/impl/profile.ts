import { Tools } from '../../../types';
import * as voiceProfile from '../../../ai/voiceProfile';
import { t } from '../langs';

interface ProfileRequest {
    /** Stable id of the echo session, used to arm the registration flow. */
    sessionId?: string;
    /** Name of the speaker recognized through the voice profile, if any. */
    user?: string;
}

export const tools: Tools = {
    configureProfile: {
        exec: async (req: ProfileRequest) => {
            if (req?.sessionId) {
                voiceProfile.beginRegistration(req.sessionId);
            }
            return t('profile.askName');
        },
    },
    whoAmI: {
        exec: async (req: ProfileRequest) => {
            const user = req?.user;
            if (!user) {
                return t('whoAmI.unknown');
            }
            return t('whoAmI.response', { name: user });
        },
    },
};

export default tools;
