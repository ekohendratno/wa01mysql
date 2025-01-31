exports.isValidPhoneNumber = (number) => {
    const phoneRegex = /^[0-9]{10,15}$/;
    return phoneRegex.test(number);
};

exports.isValidGroupId = (groupId) => {
    const groupIdRegex = /^[0-9]{18}@g\.us$/;
    return groupIdRegex.test(groupId);
};

